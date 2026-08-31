using System;
using System.Globalization;
using System.Security.Cryptography;

namespace Venviewer.NativeCapture
{
    internal enum RasterRowOrigin
    {
        LowerLeft,
        UpperLeft
    }

    internal sealed class UnityGammaUnormRgb24Frame
    {
        private readonly byte[] _bytes;

        internal UnityGammaUnormRgb24Frame(
            int width,
            int height,
            RasterRowOrigin rowOrigin,
            byte[] bytes)
        {
            DisplayEncodingPolicy.RequireDimensions(width, height);
            DisplayEncodingPolicy.RequireRowOrigin(rowOrigin);
            DisplayEncodingPolicy.RequireByteLength(
                bytes,
                width,
                height,
                3,
                "Unity Gamma UNorm RGB24 display-code frame");

            Width = width;
            Height = height;
            RowOrigin = rowOrigin;
            _bytes = (byte[])bytes.Clone();
            Sha256 = DisplayEncodingPolicy.Sha256Bytes(_bytes);
        }

        internal int Width { get; private set; }
        internal int Height { get; private set; }
        internal RasterRowOrigin RowOrigin { get; private set; }
        internal long ByteLength { get { return _bytes.LongLength; } }
        internal string Sha256 { get; private set; }

        internal byte[] CopyBytes()
        {
            return (byte[])_bytes.Clone();
        }
    }

    internal sealed class SrgbTaggedDisplayFrame
    {
        private readonly byte[] _sampleBytes;

        internal SrgbTaggedDisplayFrame(
            int width,
            int height,
            int bitDepth,
            RasterRowOrigin rowOrigin,
            byte[] sampleBytes)
        {
            DisplayEncodingPolicy.RequireDimensions(width, height);
            DisplayEncodingPolicy.RequireRowOrigin(rowOrigin);
            if (bitDepth != 8 && bitDepth != 16)
            {
                throw new ArgumentOutOfRangeException(
                    "bitDepth",
                    bitDepth,
                    "An sRGB-tagged display frame must use 8-bit or 16-bit samples.");
            }

            int bytesPerPixel = bitDepth == 8 ? 3 : 6;
            DisplayEncodingPolicy.RequireByteLength(
                sampleBytes,
                width,
                height,
                bytesPerPixel,
                "sRGB-tagged display frame");

            Width = width;
            Height = height;
            BitDepth = bitDepth;
            RowOrigin = rowOrigin;
            _sampleBytes = (byte[])sampleBytes.Clone();
            Sha256 = DisplayEncodingPolicy.Sha256Bytes(_sampleBytes);
        }

        internal int Width { get; private set; }
        internal int Height { get; private set; }
        internal int BitDepth { get; private set; }
        internal RasterRowOrigin RowOrigin { get; private set; }
        internal int BytesPerPixel { get { return BitDepth == 8 ? 3 : 6; } }
        internal long ByteLength { get { return _sampleBytes.LongLength; } }
        internal string Sha256 { get; private set; }

        internal byte[] CopySampleBytes()
        {
            return (byte[])_sampleBytes.Clone();
        }
    }

    internal static class DisplayEncodingPolicy
    {
        internal const string BrowserDisplay8CodeMapping =
            "IDENTITY_UNITY_GAMMA_UNORM_DISPLAY_CODE_VALUES_TO_SRGB_TAGGED_PNG8";
        internal const string BrowserDisplay16CodeMapping =
            "UINT8_CODE_VALUE_TIMES_257_TO_SRGB_TAGGED_PNG16_NO_ADDED_PRECISION";
        internal const string RawRgb24Semantics =
            "Unity_Gamma_R8G8B8A8_UNorm_display_code_values_read_via_Texture2D_RGB24_lower_left_before_row_flip";
        internal const bool RawRgb24LinearLightPhotometryClaimed = false;
        internal const bool ExactPhotometricTransferClaimed = false;
        internal const bool Expanded16AddsPrecision = false;
        internal const string Identity8LutSha256 =
            "40AFF2E9D2D8922E47AFD4648E6967497158785FBD1DA870E7110266BF944880";
        internal const string Expand8To16BigEndianLutSha256 =
            "F393097E80EC38DB493EB054A0886181EB2C0E8CF7B5CDF1DE392FBE94B0D1F5";

        private const string Identity8LutBase64 =
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1" +
            "Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWpr" +
            "bG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6Ch" +
            "oqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX" +
            "2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==";

        private const string Expand8To16BigEndianLutBase64 =
            "AAABAQICAwMEBAUFBgYHBwgICQkKCgsLDAwNDQ4ODw8QEBEREhITExQUFRUWFhcXGBgZGRoa" +
            "GxscHB0dHh4fHyAgISEiIiMjJCQlJSYmJycoKCkpKiorKywsLS0uLi8vMDAxMTIyMzM0NDU1" +
            "NjY3Nzg4OTk6Ojs7PDw9PT4+Pz9AQEFBQkJDQ0RERUVGRkdHSEhJSUpKS0tMTE1NTk5PT1BQ" +
            "UVFSUlNTVFRVVVZWV1dYWFlZWlpbW1xcXV1eXl9fYGBhYWJiY2NkZGVlZmZnZ2hoaWlqamtr" +
            "bGxtbW5ub29wcHFxcnJzc3R0dXV2dnd3eHh5eXp6e3t8fH19fn5/f4CAgYGCgoODhISFhYaG" +
            "h4eIiImJioqLi4yMjY2Ojo+PkJCRkZKSk5OUlJWVlpaXl5iYmZmampubnJydnZ6en5+goKGh" +
            "oqKjo6SkpaWmpqenqKipqaqqq6usrK2trq6vr7CwsbGysrOztLS1tba2t7e4uLm5urq7u7y8" +
            "vb2+vr+/wMDBwcLCw8PExMXFxsbHx8jIycnKysvLzMzNzc7Oz8/Q0NHR0tLT09TU1dXW1tfX" +
            "2NjZ2dra29vc3N3d3t7f3+Dg4eHi4uPj5OTl5ebm5+fo6Onp6urr6+zs7e3u7u/v8PDx8fLy" +
            "8/P09PX19vb39/j4+fn6+vv7/Pz9/f7+//8=";

        private static readonly byte[] Identity8Lut = DecodeAndVerifyLut(
            Identity8LutBase64,
            256,
            Identity8LutSha256,
            "8-bit identity code-value LUT");

        private static readonly byte[] Expand8To16BigEndianLut = DecodeAndVerifyLut(
            Expand8To16BigEndianLutBase64,
            512,
            Expand8To16BigEndianLutSha256,
            "8-to-16-bit exact big-endian expansion LUT");

        internal static UnityGammaUnormRgb24Frame CreateUnityGammaUnormRgb24(
            int width,
            int height,
            RasterRowOrigin rowOrigin,
            byte[] bytes)
        {
            return new UnityGammaUnormRgb24Frame(width, height, rowOrigin, bytes);
        }

        internal static SrgbTaggedDisplayFrame MapIdentityToSrgbTagged8(
            UnityGammaUnormRgb24Frame source)
        {
            if (source == null)
            {
                throw new ArgumentNullException("source");
            }

            byte[] input = source.CopyBytes();
            var output = new byte[input.Length];
            for (int index = 0; index < input.Length; index += 1)
            {
                output[index] = Identity8Lut[input[index]];
            }

            return new SrgbTaggedDisplayFrame(
                source.Width,
                source.Height,
                8,
                source.RowOrigin,
                output);
        }

        internal static SrgbTaggedDisplayFrame ExpandToSrgbTagged16(
            UnityGammaUnormRgb24Frame source)
        {
            if (source == null)
            {
                throw new ArgumentNullException("source");
            }

            byte[] input = source.CopyBytes();
            var output = new byte[checked(input.Length * 2)];
            for (int index = 0; index < input.Length; index += 1)
            {
                int lookupOffset = input[index] * 2;
                int outputOffset = index * 2;
                output[outputOffset] = Expand8To16BigEndianLut[lookupOffset];
                output[outputOffset + 1] = Expand8To16BigEndianLut[lookupOffset + 1];
            }

            return new SrgbTaggedDisplayFrame(
                source.Width,
                source.Height,
                16,
                source.RowOrigin,
                output);
        }

        internal static byte[] CopyIdentity8Lut()
        {
            return (byte[])Identity8Lut.Clone();
        }

        internal static byte[] CopyExpand8To16BigEndianLut()
        {
            return (byte[])Expand8To16BigEndianLut.Clone();
        }

        internal static string Sha256Bytes(byte[] bytes)
        {
            if (bytes == null)
            {
                throw new ArgumentNullException("bytes");
            }

            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] digest = sha256.ComputeHash(bytes);
                var characters = new char[digest.Length * 2];
                const string hexadecimal = "0123456789ABCDEF";
                for (int index = 0; index < digest.Length; index += 1)
                {
                    characters[index * 2] = hexadecimal[digest[index] >> 4];
                    characters[(index * 2) + 1] = hexadecimal[digest[index] & 15];
                }
                return new string(characters);
            }
        }

        internal static void RequireDimensions(int width, int height)
        {
            if (width <= 0 || height <= 0)
            {
                throw new ArgumentOutOfRangeException(
                    "width",
                    "Raster dimensions must both be positive.");
            }
            checked
            {
                int ignored = width * height;
                if (ignored <= 0)
                {
                    throw new ArgumentOutOfRangeException("width");
                }
            }
        }

        internal static void RequireRowOrigin(RasterRowOrigin rowOrigin)
        {
            if (rowOrigin != RasterRowOrigin.LowerLeft &&
                rowOrigin != RasterRowOrigin.UpperLeft)
            {
                throw new ArgumentOutOfRangeException(
                    "rowOrigin",
                    rowOrigin,
                    "The raster row origin is not recognized.");
            }
        }

        internal static void RequireByteLength(
            byte[] bytes,
            int width,
            int height,
            int bytesPerPixel,
            string label)
        {
            if (bytes == null)
            {
                throw new ArgumentNullException("bytes");
            }
            if (bytesPerPixel <= 0)
            {
                throw new ArgumentOutOfRangeException("bytesPerPixel");
            }

            long expected = checked((long)width * height * bytesPerPixel);
            if (bytes.LongLength != expected)
            {
                throw new ArgumentException(
                    label + " has " + bytes.LongLength.ToString(CultureInfo.InvariantCulture) +
                    " bytes; expected " + expected.ToString(CultureInfo.InvariantCulture) + ".",
                    "bytes");
            }
        }

        private static byte[] DecodeAndVerifyLut(
            string base64,
            int expectedLength,
            string expectedSha256,
            string label)
        {
            byte[] bytes = Convert.FromBase64String(base64);
            string actualSha256 = Sha256Bytes(bytes);
            if (bytes.Length != expectedLength ||
                !String.Equals(actualSha256, expectedSha256, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(label + " failed its embedded integrity check.");
            }
            return bytes;
        }
    }
}
