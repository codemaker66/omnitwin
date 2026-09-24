import { memo, useMemo } from "react";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { tableSettingHeight, tableSettingLayout } from "./table-setting-layout.js";
import { useTableSettingResources } from "./table-setting-resources.js";

interface TableSettingMeshProps {
  readonly tableItem: CatalogueItem;
  readonly opacity?: number;
  readonly settingsCount?: number;
}

/**
 * Dinner covers for one table, in the table's local frame. Every part keeps
 * its own mesh, transform and render order (see table-setting-resources.ts);
 * geometries and materials come from the shared set for this opacity.
 * Memoised: a table drag moves the parent group, not these covers.
 */
export const TableSettingMesh = memo(function TableSettingMesh({
  tableItem,
  opacity = 1,
  settingsCount,
}: TableSettingMeshProps): React.ReactElement {
  const settings = useMemo(
    () => tableSettingLayout(tableItem, settingsCount),
    [settingsCount, tableItem],
  );
  const { plate, rim, glass, knife, fork } = useTableSettingResources(opacity);
  const y = tableSettingHeight(tableItem);

  return (
    <group name="table-setting-dinner">
      {settings.map((setting, index) => (
        <group
          // Table settings are generated from stable table geometry and index.
          key={`${String(index)}-${String(setting.x)}-${String(setting.z)}`}
          position={[setting.x, y, setting.z]}
          rotation={[0, setting.rotationY, 0]}
        >
          <mesh geometry={plate.geometry} material={plate.material} renderOrder={6} />
          <mesh
            geometry={rim.geometry}
            material={rim.material}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.008, 0]}
            renderOrder={7}
          />
          <mesh
            geometry={glass.geometry}
            material={glass.material}
            position={[0.115, 0.07, -0.03]}
            renderOrder={7}
          />
          <mesh
            geometry={knife.geometry}
            material={knife.material}
            position={[-0.15, 0.014, 0]}
            rotation={[0, 0, 0]}
            renderOrder={7}
          />
          <mesh
            geometry={fork.geometry}
            material={fork.material}
            position={[0.15, 0.014, 0.015]}
            renderOrder={7}
          />
        </group>
      ))}
    </group>
  );
});
