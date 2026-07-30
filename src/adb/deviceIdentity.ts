import type { DeviceDescriptor } from "../core/types";

export interface DeviceIdentitySource {
  serial: string;
  name?: string;
  model?: string;
  vendorId: number;
  productId: number;
}

export function formatDeviceLabel(
  source: Pick<DeviceIdentitySource, "serial" | "name" | "model">,
): string {
  const name =
    source.model?.trim() || source.name?.trim() || "Android device";
  return `${name} · ${source.serial}`;
}

export function createDeviceDescriptor(
  source: DeviceIdentitySource,
): DeviceDescriptor {
  const descriptor: DeviceDescriptor = {
    serial: source.serial,
    name: source.name?.trim() || "Android device",
    model: source.model?.trim() || undefined,
    label: "",
    vendorId: source.vendorId,
    productId: source.productId,
  };
  descriptor.label = formatDeviceLabel(descriptor);
  return descriptor;
}

export function mergeDeviceDescriptors(
  ...collections: readonly (readonly DeviceDescriptor[])[]
): DeviceDescriptor[] {
  const bySerial = new Map<string, DeviceDescriptor>();
  for (const collection of collections) {
    for (const descriptor of collection) {
      const previous = bySerial.get(descriptor.serial);
      bySerial.set(descriptor.serial, {
        ...previous,
        ...descriptor,
        model: descriptor.model ?? previous?.model,
        label: formatDeviceLabel({
          serial: descriptor.serial,
          name: descriptor.name || previous?.name,
          model: descriptor.model ?? previous?.model,
        }),
      });
    }
  }
  return [...bySerial.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}
