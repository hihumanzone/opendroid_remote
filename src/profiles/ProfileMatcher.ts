import type { GameProfile } from "./schema";

export type ProfileMatchType =
  | "exact"
  | "multi"
  | "wildcard"
  | "default-fallback";

export interface ProfileMatchResult {
  profile: GameProfile;
  matchType: ProfileMatchType;
  matchedPackage?: string;
}

/**
 * Splits a package name pattern string containing potential comma-, semicolon-,
 * or space-delimited packages into trimmed tokens.
 */
export function splitPackagePatterns(pattern: string | undefined): string[] {
  if (!pattern) return [];
  return pattern
    .split(/[,;\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Checks whether a single pattern token matches the given target package.
 * Supports exact match and wildcard prefix match (e.g. "com.pubg.*").
 */
export function matchesSinglePattern(
  patternToken: string,
  targetPackage: string,
): { matches: boolean; isWildcard: boolean } {
  const normPattern = patternToken.trim().toLowerCase();
  const normTarget = targetPackage.trim().toLowerCase();

  if (normPattern.length === 0 || normTarget.length === 0) {
    return { matches: false, isWildcard: false };
  }

  if (normPattern.endsWith("*")) {
    const prefix = normPattern.slice(0, -1);
    const matches = normTarget.startsWith(prefix);
    return { matches, isWildcard: true };
  }

  if (normPattern.includes("*")) {
    const escaped = normPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const regex = new RegExp(`^${escaped}$`, "i");
    return { matches: regex.test(normTarget), isWildcard: true };
  }

  return { matches: normPattern === normTarget, isWildcard: false };
}

/**
 * Evaluates whether a profile's packageName field matches a target package.
 * Supports single packages, comma/semicolon/space-separated multi-packages,
 * and wildcard expressions.
 */
export function matchesPackage(
  pattern: string | undefined,
  targetPackage: string,
): { matches: boolean; matchType?: "exact" | "multi" | "wildcard" } {
  if (!pattern || !targetPackage) return { matches: false };

  const tokens = splitPackagePatterns(pattern);
  if (tokens.length === 0) return { matches: false };

  if (tokens.length === 1) {
    const token = tokens[0]!;
    const { matches, isWildcard } = matchesSinglePattern(token, targetPackage);
    if (!matches) return { matches: false };
    return { matches: true, matchType: isWildcard ? "wildcard" : "exact" };
  }

  // Multiple tokens in pattern
  for (const token of tokens) {
    const { matches, isWildcard } = matchesSinglePattern(token, targetPackage);
    if (matches) {
      return { matches: true, matchType: isWildcard ? "wildcard" : "multi" };
    }
  }

  return { matches: false };
}

/**
 * Finds the best-matching profile for a given target package.
 * Search priority:
 *   1. Exact single-package matches
 *   2. Multi-package exact token matches
 *   3. Wildcard pattern matches
 *   4. Default fallback profile (if provided and fallback requested)
 */
export function findProfileForPackage(
  profiles: readonly GameProfile[],
  targetPackage: string | undefined,
  options: {
    defaultProfileId?: string;
    fallbackToDefault?: boolean;
    isLauncherOrHome?: boolean;
  } = {},
): ProfileMatchResult | undefined {
  const { defaultProfileId, fallbackToDefault = true, isLauncherOrHome = false } = options;

  // If the device is on launcher/home, directly return the default fallback if requested
  if (isLauncherOrHome && fallbackToDefault) {
    const defaultProfile = resolveDefaultProfile(profiles, defaultProfileId);
    if (defaultProfile) {
      return {
        profile: defaultProfile,
        matchType: "default-fallback",
      };
    }
  }

  if (targetPackage && targetPackage.trim().length > 0) {
    let bestMatch: ProfileMatchResult | undefined;

    for (const profile of profiles) {
      const { matches, matchType } = matchesPackage(
        profile.game?.packageName,
        targetPackage,
      );

      if (matches && matchType) {
        // Exact match is highest priority, return immediately
        if (matchType === "exact") {
          return {
            profile,
            matchType: "exact",
            matchedPackage: targetPackage,
          };
        }

        // Multi-package is second priority
        if (matchType === "multi" && (!bestMatch || bestMatch.matchType === "wildcard")) {
          bestMatch = {
            profile,
            matchType: "multi",
            matchedPackage: targetPackage,
          };
        }

        // Wildcard match is third priority
        if (matchType === "wildcard" && !bestMatch) {
          bestMatch = {
            profile,
            matchType: "wildcard",
            matchedPackage: targetPackage,
          };
        }
      }
    }

    if (bestMatch) return bestMatch;
  }

  // No specific profile matched. If fallback is enabled, return the default profile
  if (fallbackToDefault) {
    const defaultProfile = resolveDefaultProfile(profiles, defaultProfileId);
    if (defaultProfile) {
      return {
        profile: defaultProfile,
        matchType: "default-fallback",
      };
    }
  }

  return undefined;
}

/**
 * Resolves the designated default profile from the collection.
 * Checks defaultProfileId, or a profile named / containing "default",
 * or falls back to the first available profile.
 */
export function resolveDefaultProfile(
  profiles: readonly GameProfile[],
  defaultProfileId?: string,
): GameProfile | undefined {
  if (profiles.length === 0) return undefined;

  if (defaultProfileId) {
    const explicit = profiles.find((p) => p.id === defaultProfileId);
    if (explicit) return explicit;
  }

  const byName = profiles.find((p) =>
    p.name.toLowerCase().includes("default"),
  );
  if (byName) return byName;

  return profiles[0];
}
