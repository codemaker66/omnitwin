using System;
using System.Globalization;
using System.IO;
using Newtonsoft.Json;

namespace Venviewer.NativeCapture
{
    internal sealed class FixedCameraProfile
    {
        public string SchemaVersion { get; set; }
        public string ProfileId { get; set; }
        public string Authority { get; set; }
        public string TruthClass { get; set; }
        public string RoomRef { get; set; }
        public int SourcePoseIndex { get; set; }
        public string SourcePoseTimestamp { get; set; }
        public FixedCameraFrames Frames { get; set; }
        public FixedCameraProjection Projection { get; set; }
        public FixedCameraOutput Output { get; set; }
        public FixedCameraEnvironment Environment { get; set; }
        public string TargetDerivation { get; set; }
        public bool InspectionOnly { get; set; }
        public string[] Limitations { get; set; }

        [JsonIgnore]
        internal string Path { get; private set; }

        [JsonIgnore]
        internal string Sha256 { get; private set; }

        internal static FixedCameraProfile Load(string path, string expectedSha256)
        {
            string normalizedPath = CapturePolicy.NormalizePath(path);
            string expected = CapturePolicy.RequireSha256(expectedSha256, "camera profile SHA-256");
            if (!File.Exists(normalizedPath))
            {
                throw new FileNotFoundException("The digest-bound fixed-camera profile is missing.", normalizedPath);
            }

            string actual = CapturePolicy.Sha256File(normalizedPath);
            if (!String.Equals(actual, expected, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "The fixed-camera profile SHA-256 changed. Expected " + expected + " but found " + actual + ".");
            }

            var settings = new JsonSerializerSettings
            {
                MissingMemberHandling = MissingMemberHandling.Error
            };
            FixedCameraProfile profile = JsonConvert.DeserializeObject<FixedCameraProfile>(
                File.ReadAllText(normalizedPath),
                settings);
            if (profile == null)
            {
                throw new InvalidDataException("The fixed-camera profile decoded to null.");
            }

            profile.Path = normalizedPath;
            profile.Sha256 = actual;
            profile.Validate();
            return profile;
        }

        internal Vec3d SourcePosition()
        {
            return RequireVector(Frames.Source.Position, "source position");
        }

        internal Vec3d SourceTarget()
        {
            return RequireVector(Frames.Source.Target, "source target");
        }

        internal Vec3d SourceUp()
        {
            return RequireVector(Frames.Source.Up, "source up");
        }

        internal Vec3d ExpectedNativePosition()
        {
            return RequireVector(Frames.Native.ExpectedPosition, "expected native position");
        }

        internal Vec3d ExpectedNativeTarget()
        {
            return RequireVector(Frames.Native.ExpectedTarget, "expected native target");
        }

        internal Vec3d ExpectedNativeUp()
        {
            return RequireVector(Frames.Native.ExpectedUp, "expected native up");
        }

        internal Vec3d ExpectedNativeDirection()
        {
            return RequireVector(Frames.Native.ExpectedDirection, "expected native direction");
        }

        private void Validate()
        {
            RequireEqual("schemaVersion", SchemaVersion, "venviewer.grand-hall.fixed-camera-profile.v1");
            RequireEqual("authority", Authority, "none");
            RequireEqual("truthClass", TruthClass, "RECONSTRUCTED_DIAGNOSTIC");
            RequireEqual("roomRef", RoomRef, "trades-hall/grand-hall");
            RequireEqual("source frame", Frames == null || Frames.Source == null ? null : Frames.Source.Id,
                "xgrids_lcc2_source_z_up");
            RequireEqual("native frame", Frames == null || Frames.Native == null ? null : Frames.Native.Id,
                "xgrids_lcceditor_unity_y_up");
            RequireEqual("Three frame", Frames == null || Frames.Three == null ? null : Frames.Three.Id,
                "venviewer_browser_centered_y_up");
            RequireEqual(
                "Three mapping status",
                Frames == null || Frames.Three == null ? null : Frames.Three.MappingStatus,
                "diagnostic_browser_frontier_mapping_not_accepted_room_transform");
            RequireEqual(
                "environment exclusion reason",
                Environment == null ? null : Environment.Reason,
                "browser_frontier_parity_env_sog_excluded");
            RequireEqual(
                "target derivation",
                TargetDerivation,
                "pose_q05_q95_horizontal_centre_at_source_pose_height");

            if (String.IsNullOrWhiteSpace(ProfileId) || SourcePoseIndex < 0 ||
                String.IsNullOrWhiteSpace(SourcePoseTimestamp) || !InspectionOnly)
            {
                throw new InvalidDataException("The fixed-camera identity or inspection-only gate is invalid.");
            }

            if (Frames == null || Frames.Source == null || Frames.Native == null || Frames.Three == null ||
                Projection == null || Output == null || Environment == null)
            {
                throw new InvalidDataException("The fixed-camera profile is missing a required contract section.");
            }

            Vec3d sourcePosition = SourcePosition();
            Vec3d sourceTarget = SourceTarget();
            Vec3d sourceUp = SourceUp();
            Vec3d expectedPosition = ExpectedNativePosition();
            Vec3d expectedTarget = ExpectedNativeTarget();
            Vec3d expectedUp = ExpectedNativeUp();
            ExpectedNativeDirection();
            RequireArray(Frames.Native.ExpectedQuaternionXyzw, 4, "expected native quaternion");
            RequireVector(Frames.Three.Position, "Three position");
            RequireVector(Frames.Three.Target, "Three target");
            RequireVector(Frames.Three.Up, "Three up");

            if (!IsFinite(Frames.Native.AssertionTolerance) || Frames.Native.AssertionTolerance <= 0.0)
            {
                throw new InvalidDataException("The native assertion tolerance must be finite and positive.");
            }

            CapturePolicy.RequireApproximatelyEqual(
                "profile raw native position",
                CapturePolicy.RawLccSourceToUnity(sourcePosition),
                expectedPosition,
                Frames.Native.AssertionTolerance);
            CapturePolicy.RequireApproximatelyEqual(
                "profile raw native target",
                CapturePolicy.RawLccSourceToUnity(sourceTarget),
                expectedTarget,
                Frames.Native.AssertionTolerance);
            Vec3d rawUpEnd = CapturePolicy.RawLccSourceToUnity(sourcePosition + sourceUp);
            CapturePolicy.RequireApproximatelyEqual(
                "profile raw native up",
                new Vec3d(
                    rawUpEnd.X - expectedPosition.X,
                    rawUpEnd.Y - expectedPosition.Y,
                    rawUpEnd.Z - expectedPosition.Z),
                expectedUp,
                Frames.Native.AssertionTolerance);

            if (!String.Equals(Projection.Type, "perspective", StringComparison.Ordinal) ||
                Output.Width != 1600 || Output.Height != 900 || Output.DevicePixelRatio != 1 ||
                !IsFinite(Projection.VerticalFieldOfViewDegrees) || Projection.VerticalFieldOfViewDegrees <= 0.0 ||
                !IsFinite(Projection.NearClipMetres) || Projection.NearClipMetres <= 0.0 ||
                !IsFinite(Projection.FarClipMetres) || Projection.FarClipMetres <= Projection.NearClipMetres ||
                !IsFinite(Projection.Aspect) ||
                Math.Abs(Projection.Aspect - ((double)Output.Width / Output.Height)) > 0.000000000001)
            {
                throw new InvalidDataException("The fixed-camera projection or 1600x900 output contract is invalid.");
            }

            if (Environment.Include || Environment.VisibilityGetterAvailable)
            {
                throw new InvalidDataException(
                    "The native lane must request environment data false and must not claim a visibility getter exists.");
            }

            if (Limitations == null || Limitations.Length == 0)
            {
                throw new InvalidDataException("The fixed-camera profile must retain its inspection-only limitations.");
            }
        }

        private static Vec3d RequireVector(double[] values, string label)
        {
            RequireArray(values, 3, label);
            return new Vec3d(values[0], values[1], values[2]);
        }

        private static void RequireArray(double[] values, int length, string label)
        {
            if (values == null || values.Length != length)
            {
                throw new InvalidDataException(label + " must contain exactly " +
                    length.ToString(CultureInfo.InvariantCulture) + " finite values.");
            }

            for (int index = 0; index < values.Length; index += 1)
            {
                if (!IsFinite(values[index]))
                {
                    throw new InvalidDataException(label + " contains a non-finite value.");
                }
            }
        }

        private static void RequireEqual(string label, string actual, string expected)
        {
            if (!String.Equals(actual, expected, StringComparison.Ordinal))
            {
                throw new InvalidDataException(label + " must be exactly '" + expected + "'.");
            }
        }

        private static bool IsFinite(double value)
        {
            return !Double.IsNaN(value) && !Double.IsInfinity(value);
        }
    }

    internal sealed class FixedCameraFrames
    {
        public SourceCameraFrame Source { get; set; }
        public NativeCameraFrame Native { get; set; }
        public ThreeCameraFrame Three { get; set; }
    }

    internal sealed class SourceCameraFrame
    {
        public string Id { get; set; }
        public double[] Position { get; set; }
        public double[] Target { get; set; }
        public double[] Up { get; set; }
    }

    internal sealed class NativeCameraFrame
    {
        public string Id { get; set; }
        public double[] ExpectedPosition { get; set; }
        public double[] ExpectedTarget { get; set; }
        public double[] ExpectedUp { get; set; }
        public double[] ExpectedDirection { get; set; }
        public double[] ExpectedQuaternionXyzw { get; set; }
        public double AssertionTolerance { get; set; }
    }

    internal sealed class ThreeCameraFrame
    {
        public string Id { get; set; }
        public double[] Position { get; set; }
        public double[] Target { get; set; }
        public double[] Up { get; set; }
        public string MappingStatus { get; set; }
    }

    internal sealed class FixedCameraProjection
    {
        public string Type { get; set; }
        public double VerticalFieldOfViewDegrees { get; set; }
        public double NearClipMetres { get; set; }
        public double FarClipMetres { get; set; }
        public double Aspect { get; set; }
    }

    internal sealed class FixedCameraOutput
    {
        public int Width { get; set; }
        public int Height { get; set; }
        public int DevicePixelRatio { get; set; }
    }

    internal sealed class FixedCameraEnvironment
    {
        public bool Include { get; set; }
        public string Reason { get; set; }
        public bool VisibilityGetterAvailable { get; set; }
    }
}
