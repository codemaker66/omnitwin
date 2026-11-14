// ---------------------------------------------------------------------------
// SurveyedRoomModel — a surveyed room as a real-time room
//
// Draws a room loaded by use-surveyed-room.ts: its walls' measured relief,
// its ceiling and its floor, each wearing the scan's photograph of it as
// taken (room-materials.ts). Three draws: the walls, the ceiling, the floor.
// Every face looks into the room and only front faces are drawn, so a camera
// outside the room sees in through the walls nearest it.
//
// The surfaces are there from the first frame, in a plain tone; the
// photographs follow in the background and are swapped in as each arrives
// (room-photos.ts). `onPhotoProgress` says how many this device loads and how
// many have arrived or failed, by name: a caller shows that through the
// shared Activity component and can say when a photograph did not load.
//
// Everything on the GPU is made here and freed here: the three geometries,
// the three materials and the photographs go when the room, the photograph
// quality or the component does. Frames are drawn on demand: one is asked for
// when a photograph arrives or the grade changes.
//
// Version 1 leaves out, on purpose, what the Grand Hall's own model has: the
// walls' 2 mm detail, relighting by baked light, the cutaway's wall bodies
// and section lines, light fittings, doors, the sun and sky, and the walk.
// ---------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import type { Group } from "three";
import { useHallFinish } from "../grand-hall/hall-finish.js";
import { nativeFramePrecompile } from "../../lib/native-frame-composer.js";
import { requestNativePrecompile } from "../../lib/native-precompile.js";
import { getNativeRenderer } from "../../lib/native-renderer.js";
import { SELECTION_PICK_IGNORED } from "../../lib/raycast-gate.js";
import { createRoomBuffers } from "./room-buffers.js";
import { createRoomMaterials, disposeRoomMaterials, RoomGradeUniforms, type RoomGrade } from "./room-materials.js";
import { RoomPhotos, roomPhotoSources } from "./room-photos.js";
import type { SurveyedRoom } from "./use-surveyed-room.js";

/** The room itself is never selected, so a press does not test its triangles (lib/raycast-gate.ts). */
const ROOM_USER_DATA = { [SELECTION_PICK_IGNORED]: true };

/** How a room's photographs stand: counted as files, never estimated. */
export interface SurveyedRoomPhotoProgress {
  /** The photographs this device loads for the room. */
  readonly expected: number;
  /** Those that have arrived or failed. */
  readonly settled: number;
  /** The files that failed; their surfaces stay in the plain tone. */
  readonly failed: readonly string[];
}

export interface SurveyedRoomModelProps {
  readonly room: SurveyedRoom;
  /**
   * Which size of each photograph to load: 1 the largest, 0.5 the next size
   * down. By default the device's own (grand-hall/hall-finish.ts).
   */
  readonly photoQuality?: number;
  /** The room's grade (room-materials.ts); as photographed where left out. */
  readonly grade?: RoomGrade;
  /** Told at once how many photographs are expected, then as each arrives or fails. */
  readonly onPhotoProgress?: (progress: SurveyedRoomPhotoProgress) => void;
}

/** White, as a number: the tint of a room shown as photographed. */
const NO_TINT = 0xffffff;

export function SurveyedRoomModel({ room, photoQuality, grade, onPhotoProgress }: SurveyedRoomModelProps): ReactElement {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const deviceFinish = useHallFinish();
  const quality = photoQuality ?? deviceFinish.photoQuality;

  const buffers = useMemo(() => createRoomBuffers(room.geometry), [room]);
  useEffect(() => () => { buffers.dispose(); }, [buffers]);

  // The photographs belong to the room and the device's quality; the materials sample them.
  const photos = useMemo(() => new RoomPhotos(), [quality, room]);
  useEffect(() => () => { photos.dispose(); }, [photos]);
  const uniforms = useMemo(() => new RoomGradeUniforms(), []);
  const materials = useMemo(() => createRoomMaterials(photos, uniforms), [photos, uniforms]);
  useEffect(() => () => { disposeRoomMaterials(materials); }, [materials]);

  // Before the first frame, and whenever a value changes.
  const exposure = grade?.exposure ?? 1;
  const tint = grade?.tint ?? NO_TINT;
  const glow = grade?.glow ?? 1;
  useLayoutEffect(() => {
    uniforms.set({ exposure, tint, glow });
    invalidate();
  }, [exposure, glow, invalidate, tint, uniforms]);

  // The latest callback, without a change of callback fetching the photographs again.
  const report = useRef(onPhotoProgress);
  useLayoutEffect(() => { report.current = onPhotoProgress; });

  useEffect(() => {
    let live = true;
    const sources = roomPhotoSources(room.record, room.entry, quality);
    const failed: string[] = [];
    let settled = 0;
    const tell = (): void => { report.current?.({ expected: sources.length, settled, failed: [...failed] }); };
    tell();
    photos.load(sources, (source, loaded) => {
      if (!live) return;
      settled += 1;
      if (!loaded) failed.push(source.file);
      tell();
      invalidate();
    });
    return () => { live = false; };
  }, [invalidate, photos, quality, room]);

  // The room's pipelines for the planner's scene pass, compiled before it
  // first draws them, as the Grand Hall's are (lib/native-precompile.ts,
  // F-01). Where the view draws plainly there is no pass to compile for.
  const group = useRef<Group | null>(null);
  useLayoutEffect(() => {
    const renderer = getNativeRenderer(gl);
    if (renderer === null || group.current === null) return undefined;
    let live = true;
    // Read after the job is queued: the effect may have been torn down meanwhile.
    const stillMounted = (): boolean => live;
    void requestNativePrecompile(renderer, async (signal) => {
      if (!stillMounted() || signal.aborted) return;
      const scenePass = nativeFramePrecompile(renderer);
      if (scenePass !== null) await scenePass(signal);
    });
    return () => { live = false; };
  }, [buffers, gl, materials]);

  return (
    // dispose={null}: what is drawn here is freed by the effects above, once, not by the reconciler too.
    <group ref={group} name="surveyed-room" userData={ROOM_USER_DATA} dispose={null}>
      <mesh name="surveyed-room-walls" geometry={buffers.walls} material={materials.walls} frustumCulled={false} userData={ROOM_USER_DATA} />
      <mesh name="surveyed-room-ceiling" geometry={buffers.ceiling} material={materials.ceiling} frustumCulled={false} userData={ROOM_USER_DATA} />
      <mesh name="surveyed-room-floor" geometry={buffers.floor} material={materials.floor} frustumCulled={false} userData={ROOM_USER_DATA} />
    </group>
  );
}
