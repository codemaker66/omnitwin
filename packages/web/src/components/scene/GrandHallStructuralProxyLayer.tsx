import { useEffect, useMemo, type ReactElement } from "react";
import { BoxGeometry, EdgesGeometry } from "three";
import {
  GRAND_HALL_NAVIGATION_PROFILE,
  grandHallStructuralProxyBoxes,
} from "../../lib/grand-hall-navigation-profile.js";

/**
 * Explicit QA-only source extents. These wire boxes are not walls, floors,
 * doors, portals, or a structural model; they are hidden outside the selected
 * StructuralProxy evidence view.
 */
export function GrandHallStructuralProxyLayer(): ReactElement {
  const boxes = useMemo(() => grandHallStructuralProxyBoxes(), []);
  const geometries = useMemo(
    () => boxes.map((box) => {
      const boxGeometry = new BoxGeometry(box.size[0], box.size[1], box.size[2]);
      const edges = new EdgesGeometry(boxGeometry);
      boxGeometry.dispose();
      return edges;
    }),
    [boxes],
  );

  useEffect(() => () => {
    for (const geometry of geometries) geometry.dispose();
  }, [geometries]);

  return (
    <group
      name="grand-hall-source-envelope-diagnostic"
      userData={{
        truthClass: GRAND_HALL_NAVIGATION_PROFILE.truthClass,
        claim: "source_extent_not_room_shell",
        profileSha256: GRAND_HALL_NAVIGATION_PROFILE.profileSha256,
        frontierReceiptSha256: GRAND_HALL_NAVIGATION_PROFILE.capturedFrontier.receiptSha256,
        poseSourceSha256: GRAND_HALL_NAVIGATION_PROFILE.source.sha256,
        reconstructedMeshSha256: GRAND_HALL_NAVIGATION_PROFILE.reconstructedMesh.sha256,
      }}
    >
      {boxes.map((box, index) => (
        <lineSegments
          key={box.id}
          name={box.id}
          geometry={geometries[index]}
          position={box.center}
          userData={{ claim: box.claim }}
        >
          <lineBasicMaterial
            color={index === 0 ? "#66b8c4" : "#d9ae56"}
            transparent
            opacity={index === 0 ? 0.44 : 0.82}
            depthTest={false}
          />
        </lineSegments>
      ))}
      <mesh
        name="unreviewed-diagnostic-spawn"
        position={GRAND_HALL_NAVIGATION_PROFILE.diagnosticSpawn.position}
        userData={{ reviewStatus: "unreviewed" }}
      >
        <sphereGeometry args={[0.12, 12, 8]} />
        <meshBasicMaterial color="#d9ae56" wireframe depthTest={false} />
      </mesh>
    </group>
  );
}
