import {
  AdbAuthType,
  AdbDaemonTransport,
  AdbPublicKeyAuthenticator,
  AdbSignatureAuthenticator,
  type AdbAuthenticator,
  type AdbCredentialStore,
  type AdbDaemonConnection,
} from "@yume-chan/adb";

export interface AuthenticateAdbConnectionOptions {
  serial: string;
  connection: AdbDaemonConnection;
  credentialStore: AdbCredentialStore;
  authenticate?: typeof AdbDaemonTransport.authenticate;
  handshakeTimeoutMs: number;
  authorizationTimeoutMs: number;
  isCurrent(): boolean;
  closeConnection(): void | Promise<void>;
  onApprovalRequired(): void;
}

export class StaleAdbHandshakeError extends Error {
  constructor() {
    super("The ADB handshake did not respond to the saved identity.");
    this.name = "StaleAdbHandshakeError";
  }
}

function observeAuthenticator(
  authenticator: AdbAuthenticator,
  onResponse: (type: number) => void,
): AdbAuthenticator {
  return async function* observedAuthenticator(
    credentialStore,
    getNextRequest,
  ) {
    for await (const packet of authenticator(
      credentialStore,
      getNextRequest,
    )) {
      onResponse(packet.arg0);
      yield packet;
    }
  };
}

/**
 * Runs one ADB authentication handshake and reports approval only when the
 * protocol actually sends the browser public key. Signature-only handshakes
 * for already-trusted devices never enter the approval state.
 */
export async function authenticateAdbConnection({
  serial,
  connection,
  credentialStore,
  authenticate = AdbDaemonTransport.authenticate,
  handshakeTimeoutMs,
  authorizationTimeoutMs,
  isCurrent,
  closeConnection,
  onApprovalRequired,
}: AuthenticateAdbConnectionOptions): Promise<AdbDaemonTransport> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout: ((error: Error) => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const armTimeout = (milliseconds: number, error: Error) => {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    timeoutId = globalThis.setTimeout(() => {
      void Promise.resolve(closeConnection()).catch(() => {});
      rejectTimeout?.(error);
    }, milliseconds);
  };
  const onAuthenticationResponse = (type: number) => {
    if (type !== AdbAuthType.PublicKey || !isCurrent()) return;
    onApprovalRequired();
    armTimeout(
      authorizationTimeoutMs,
      new Error(
        "ADB authorization timed out. Unlock Android, accept the USB debugging prompt, and retry.",
      ),
    );
  };
  const authenticators: readonly AdbAuthenticator[] = [
    observeAuthenticator(
      AdbSignatureAuthenticator,
      onAuthenticationResponse,
    ),
    observeAuthenticator(
      AdbPublicKeyAuthenticator,
      onAuthenticationResponse,
    ),
  ];

  armTimeout(handshakeTimeoutMs, new StaleAdbHandshakeError());
  try {
    return await Promise.race([
      authenticate({
        serial,
        connection,
        credentialStore,
        authenticators,
        // `readTimeLimit` intentionally remains unset. Long-lived ADB sockets
        // can apply legitimate backpressure and must not be treated as dead.
      }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  }
}
