import { useMemo } from "react";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { toRenderSpace } from "../../constants/scale.js";
import { noClipPlanes } from "../SectionPlane.js";

interface TableSettingMeshProps {
  readonly tableItem: CatalogueItem;
  readonly opacity?: number;
  readonly settingsCount?: number;
}

interface PlaceSetting {
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
}

function normalizeSettingCount(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Math.max(1, Math.min(48, Math.round(value)));
}

function roundSettings(tableItem: CatalogueItem, settingsCount: number | undefined): readonly PlaceSetting[] {
  const count = normalizeSettingCount(settingsCount, 10);
  const radius = toRenderSpace(tableItem.width) * 0.34;
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      rotationY: -angle + Math.PI / 2,
    };
  });
}

function rectSettings(tableItem: CatalogueItem, settingsCount: number | undefined): readonly PlaceSetting[] {
  const length = toRenderSpace(tableItem.width);
  const depth = toRenderSpace(tableItem.depth);
  const fallbackCount = Math.max(4, Math.min(12, Math.round(length / 0.55) * 2));
  const count = normalizeSettingCount(settingsCount, fallbackCount);
  const perSide = Math.max(1, Math.ceil(count / 2));
  const insetX = length * 0.36;
  const sideZ = depth * 0.25;
  const settings: PlaceSetting[] = [];
  for (let i = 0; i < perSide; i++) {
    const t = perSide === 1 ? 0.5 : i / (perSide - 1);
    const x = -insetX + t * insetX * 2;
    if (settings.length < count) settings.push({ x, z: -sideZ, rotationY: 0 });
    if (settings.length < count) settings.push({ x, z: sideZ, rotationY: Math.PI });
  }
  return settings;
}

export function TableSettingMesh({
  tableItem,
  opacity = 1,
  settingsCount,
}: TableSettingMeshProps): React.ReactElement {
  const settings = useMemo(
    () => tableItem.tableShape === "round"
      ? roundSettings(tableItem, settingsCount)
      : rectSettings(tableItem, settingsCount),
    [settingsCount, tableItem],
  );
  const y = tableItem.height + 0.032;

  return (
    <group name="table-setting-dinner">
      {settings.map((setting, index) => (
        <group
          // Table settings are generated from stable table geometry and index.
          key={`${String(index)}-${String(setting.x)}-${String(setting.z)}`}
          position={[setting.x, y, setting.z]}
          rotation={[0, setting.rotationY, 0]}
        >
          <mesh renderOrder={6}>
            <cylinderGeometry args={[0.115, 0.115, 0.012, 36]} />
            <meshStandardMaterial
              color="#f8f3e8"
              roughness={0.56}
              metalness={0.03}
              transparent
              opacity={opacity}
              clippingPlanes={noClipPlanes}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} renderOrder={7}>
            <torusGeometry args={[0.094, 0.004, 8, 36]} />
            <meshStandardMaterial
              color="#d7b75a"
              roughness={0.42}
              metalness={0.35}
              transparent
              opacity={opacity * 0.9}
              clippingPlanes={noClipPlanes}
            />
          </mesh>
          <mesh position={[0.115, 0.07, -0.03]} renderOrder={7}>
            <cylinderGeometry args={[0.026, 0.021, 0.105, 20]} />
            <meshPhysicalMaterial
              color="#cfe7ff"
              roughness={0.08}
              metalness={0}
              transparent
              opacity={opacity * 0.38}
              transmission={0.45}
              thickness={0.04}
              clippingPlanes={noClipPlanes}
            />
          </mesh>
          <mesh position={[-0.15, 0.014, 0]} rotation={[0, 0, 0]} renderOrder={7}>
            <boxGeometry args={[0.018, 0.012, 0.22]} />
            <meshStandardMaterial
              color="#d9d1bf"
              roughness={0.28}
              metalness={0.72}
              transparent
              opacity={opacity * 0.86}
              clippingPlanes={noClipPlanes}
            />
          </mesh>
          <mesh position={[0.15, 0.014, 0.015]} renderOrder={7}>
            <boxGeometry args={[0.018, 0.012, 0.19]} />
            <meshStandardMaterial
              color="#d9d1bf"
              roughness={0.28}
              metalness={0.72}
              transparent
              opacity={opacity * 0.86}
              clippingPlanes={noClipPlanes}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
