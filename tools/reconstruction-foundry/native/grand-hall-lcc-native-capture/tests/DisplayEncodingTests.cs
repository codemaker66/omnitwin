using System;
using System.IO;
using System.Text;

namespace Venviewer.NativeCapture
{
    internal static class DisplayEncodingTests
    {
        private const string ExpectedFixturePng8Sha256 =
            "95FA7DD623ED6A2E75940BB73EF630591A1B1479908FCB61949A6D402B07CBF7";
        private const string ExpectedFixturePng16Sha256 =
            "7BA8BE7303E4E13D0E62B4E123461C37A16E9F5FE4BDA0741383AE2170B97DBF";

        internal static void Run()
        {
            TestLiteralLutIntegrityAndOwnership();
            TestTwoByTwoOrientationAndMetadata();
            TestDeterministicEncoding();
            TestStrictMutationRejection();
            TestFullSizePatternRoundTrip();
            Console.WriteLine("PASS: deterministic display encoding tests");
        }

        internal static string ComputeFixtureHashReport()
        {
            UnityGammaUnormRgb24Frame source = CreateTwoByTwoUnityGammaFixture();
            byte[] png8 = DeterministicPng.Encode(
                DisplayEncodingPolicy.MapIdentityToSrgbTagged8(source));
            byte[] png16 = DeterministicPng.Encode(
                DisplayEncodingPolicy.ExpandToSrgbTagged16(source));
            return DisplayEncodingPolicy.Sha256Bytes(png8) + "|" +
                DisplayEncodingPolicy.Sha256Bytes(png16);
        }

        private static void TestLiteralLutIntegrityAndOwnership()
        {
            AssertEqual(
                "Unity_Gamma_R8G8B8A8_UNorm_display_code_values_read_via_Texture2D_RGB24_lower_left_before_row_flip",
                DisplayEncodingPolicy.RawRgb24Semantics,
                "raw RGB24 semantics");
            AssertEqual(
                false,
                DisplayEncodingPolicy.RawRgb24LinearLightPhotometryClaimed,
                "raw RGB24 linear-light photometry claim");
            AssertEqual(
                false,
                DisplayEncodingPolicy.ExactPhotometricTransferClaimed,
                "exact photometric transfer claim");
            AssertEqual(
                false,
                DisplayEncodingPolicy.Expanded16AddsPrecision,
                "expanded 16-bit precision claim");
            AssertEqual(
                "IDENTITY_UNITY_GAMMA_UNORM_DISPLAY_CODE_VALUES_TO_SRGB_TAGGED_PNG8",
                DisplayEncodingPolicy.BrowserDisplay8CodeMapping,
                "browser PNG8 mapping");
            AssertEqual(
                "UINT8_CODE_VALUE_TIMES_257_TO_SRGB_TAGGED_PNG16_NO_ADDED_PRECISION",
                DisplayEncodingPolicy.BrowserDisplay16CodeMapping,
                "browser PNG16 mapping");
            byte[] lut8 = DisplayEncodingPolicy.CopyIdentity8Lut();
            byte[] lut16 = DisplayEncodingPolicy.CopyExpand8To16BigEndianLut();
            AssertEqual(256, lut8.Length, "8-bit LUT length");
            AssertEqual(512, lut16.Length, "16-bit LUT length");
            AssertEqual(
                DisplayEncodingPolicy.Identity8LutSha256,
                DisplayEncodingPolicy.Sha256Bytes(lut8),
                "8-bit LUT SHA-256");
            AssertEqual(
                DisplayEncodingPolicy.Expand8To16BigEndianLutSha256,
                DisplayEncodingPolicy.Sha256Bytes(lut16),
                "16-bit LUT SHA-256");

            AssertEqual((byte)0, lut8[0], "8-bit LUT zero");
            AssertEqual((byte)1, lut8[1], "8-bit LUT one");
            AssertEqual((byte)64, lut8[64], "8-bit LUT 64");
            AssertEqual((byte)128, lut8[128], "8-bit LUT 128");
            AssertEqual((byte)192, lut8[192], "8-bit LUT 192");
            AssertEqual((byte)255, lut8[255], "8-bit LUT 255");
            AssertEqual((ushort)0, ReadUInt16BigEndian(lut16, 0), "16-bit LUT zero");
            AssertEqual((ushort)257, ReadUInt16BigEndian(lut16, 2), "16-bit LUT one");
            AssertEqual((ushort)16448, ReadUInt16BigEndian(lut16, 128), "16-bit LUT 64");
            AssertEqual((ushort)32896, ReadUInt16BigEndian(lut16, 256), "16-bit LUT 128");
            AssertEqual((ushort)49344, ReadUInt16BigEndian(lut16, 384), "16-bit LUT 192");
            AssertEqual((ushort)65535, ReadUInt16BigEndian(lut16, 510), "16-bit LUT 255");

            lut8[0] = 255;
            lut16[0] = 255;
            AssertEqual((byte)0, DisplayEncodingPolicy.CopyIdentity8Lut()[0], "8-bit LUT defensive copy");
            AssertEqual((byte)0, DisplayEncodingPolicy.CopyExpand8To16BigEndianLut()[0], "16-bit LUT defensive copy");

            byte[] sourceBytes = { 0, 1, 2 };
            var source = DisplayEncodingPolicy.CreateUnityGammaUnormRgb24(
                1,
                1,
                RasterRowOrigin.LowerLeft,
                sourceBytes);
            sourceBytes[0] = 255;
            AssertBytesEqual(new byte[] { 0, 1, 2 }, source.CopyBytes(), "Unity Gamma source constructor copy");
            byte[] copied = source.CopyBytes();
            copied[1] = 255;
            AssertBytesEqual(new byte[] { 0, 1, 2 }, source.CopyBytes(), "Unity Gamma source accessor copy");

            ExpectThrows<ArgumentException>(delegate
            {
                DisplayEncodingPolicy.CreateUnityGammaUnormRgb24(
                    1,
                    1,
                    RasterRowOrigin.LowerLeft,
                    new byte[2]);
            });
            ExpectThrows<ArgumentOutOfRangeException>(delegate
            {
                DisplayEncodingPolicy.CreateUnityGammaUnormRgb24(
                    0,
                    1,
                    RasterRowOrigin.LowerLeft,
                    new byte[0]);
            });
            ExpectThrows<ArgumentOutOfRangeException>(delegate
            {
                DisplayEncodingPolicy.CreateUnityGammaUnormRgb24(
                    1,
                    1,
                    (RasterRowOrigin)99,
                    new byte[3]);
            });
            ExpectThrows<ArgumentNullException>(delegate
            {
                DisplayEncodingPolicy.MapIdentityToSrgbTagged8(null);
            });
        }

        private static void TestTwoByTwoOrientationAndMetadata()
        {
            UnityGammaUnormRgb24Frame source = CreateTwoByTwoUnityGammaFixture();
            byte[] originalInput = source.CopyBytes();
            SrgbTaggedDisplayFrame display8 =
                DisplayEncodingPolicy.MapIdentityToSrgbTagged8(source);
            SrgbTaggedDisplayFrame display16 =
                DisplayEncodingPolicy.ExpandToSrgbTagged16(source);
            AssertBytesEqual(
                originalInput,
                source.CopyBytes(),
                "Unity Gamma source unchanged after both mappings");
            AssertBytesEqual(
                originalInput,
                display8.CopySampleBytes(),
                "PNG8 mapping preserves every source code value");
            byte[] expanded = display16.CopySampleBytes();
            for (int index = 0; index < originalInput.Length; index += 1)
            {
                AssertEqual(
                    (ushort)(originalInput[index] * 257),
                    ReadUInt16BigEndian(expanded, index * 2),
                    "PNG16 exact 8-to-16 expansion");
            }
            AssertEqual(RasterRowOrigin.LowerLeft, display8.RowOrigin, "8-bit source row origin");
            AssertEqual(RasterRowOrigin.LowerLeft, display16.RowOrigin, "16-bit source row origin");

            byte[] png8 = DeterministicPng.Encode(display8);
            byte[] png16 = DeterministicPng.Encode(display16);
            DeterministicPngVerification lower8 = DeterministicPng.VerifyAndDecode(
                png8,
                RasterRowOrigin.LowerLeft);
            DeterministicPngVerification upper8 = DeterministicPng.VerifyAndDecode(
                png8,
                RasterRowOrigin.UpperLeft);
            DeterministicPngVerification lower16 = DeterministicPng.VerifyAndDecode(
                png16,
                RasterRowOrigin.LowerLeft);

            AssertBytesEqual(
                display8.CopySampleBytes(),
                lower8.DecodedFrame.CopySampleBytes(),
                "8-bit lower-left round trip");
            AssertBytesEqual(
                display16.CopySampleBytes(),
                lower16.DecodedFrame.CopySampleBytes(),
                "16-bit lower-left round trip");
            AssertRowsReversed(
                display8.CopySampleBytes(),
                upper8.DecodedFrame.CopySampleBytes(),
                2,
                2,
                3,
                "8-bit upper-left decode");

            AssertVerificationMetadata(lower8, 2, 2, 8);
            AssertVerificationMetadata(lower16, 2, 2, 16);
            AssertEqual(
                ExpectedFixturePng8Sha256,
                lower8.PngSha256,
                "2x2 PNG8 golden hash");
            AssertEqual(
                ExpectedFixturePng16Sha256,
                lower16.PngSha256,
                "2x2 PNG16 golden hash");
        }

        private static void TestDeterministicEncoding()
        {
            UnityGammaUnormRgb24Frame source = CreateTwoByTwoUnityGammaFixture();
            SrgbTaggedDisplayFrame display8 =
                DisplayEncodingPolicy.MapIdentityToSrgbTagged8(source);
            SrgbTaggedDisplayFrame display16 =
                DisplayEncodingPolicy.ExpandToSrgbTagged16(source);
            byte[] first8 = DeterministicPng.Encode(display8);
            byte[] second8 = DeterministicPng.Encode(display8);
            byte[] first16 = DeterministicPng.Encode(display16);
            byte[] second16 = DeterministicPng.Encode(display16);
            AssertBytesEqual(first8, second8, "repeat PNG8 encoding");
            AssertBytesEqual(first16, second16, "repeat PNG16 encoding");
            AssertEqual(
                DisplayEncodingPolicy.Sha256Bytes(first8),
                DisplayEncodingPolicy.Sha256Bytes(second8),
                "repeat PNG8 SHA-256");
            AssertEqual(
                DisplayEncodingPolicy.Sha256Bytes(first16),
                DisplayEncodingPolicy.Sha256Bytes(second16),
                "repeat PNG16 SHA-256");
        }

        private static void TestStrictMutationRejection()
        {
            byte[] valid = DeterministicPng.Encode(
                DisplayEncodingPolicy.MapIdentityToSrgbTagged8(
                    CreateTwoByTwoUnityGammaFixture()));

            byte[] corruptCrc = (byte[])valid.Clone();
            ChunkLocation gamma = FindChunk(corruptCrc, "gAMA");
            corruptCrc[gamma.DataOffset] ^= 1;
            ExpectInvalidPng(corruptCrc, "corrupt chunk CRC");

            byte[] wrongIntent = (byte[])valid.Clone();
            ChunkLocation srgb = FindChunk(wrongIntent, "sRGB");
            wrongIntent[srgb.DataOffset] = 1;
            RewriteChunkCrc(wrongIntent, srgb);
            ExpectInvalidPng(wrongIntent, "noncanonical sRGB intent");

            byte[] wrongGamma = (byte[])valid.Clone();
            gamma = FindChunk(wrongGamma, "gAMA");
            wrongGamma[gamma.DataOffset + 3] ^= 1;
            RewriteChunkCrc(wrongGamma, gamma);
            ExpectInvalidPng(wrongGamma, "noncanonical gAMA");

            byte[] wrongChromaticity = (byte[])valid.Clone();
            ChunkLocation chromaticity = FindChunk(wrongChromaticity, "cHRM");
            wrongChromaticity[chromaticity.DataOffset + 3] ^= 1;
            RewriteChunkCrc(wrongChromaticity, chromaticity);
            ExpectInvalidPng(wrongChromaticity, "noncanonical cHRM");

            byte[] wrongAdler = (byte[])valid.Clone();
            ChunkLocation idat = FindChunk(wrongAdler, "IDAT");
            wrongAdler[idat.DataOffset + idat.DataLength - 1] ^= 1;
            RewriteChunkCrc(wrongAdler, idat);
            ExpectInvalidPng(wrongAdler, "corrupt Adler-32");

            byte[] wrongFilter = (byte[])valid.Clone();
            MutateFirstFilterAndRepairChecksums(wrongFilter);
            ExpectInvalidPng(wrongFilter, "nonzero scanline filter");

            byte[] wrongDeflateType = (byte[])valid.Clone();
            idat = FindChunk(wrongDeflateType, "IDAT");
            wrongDeflateType[idat.DataOffset + 2] = 2;
            RewriteChunkCrc(wrongDeflateType, idat);
            ExpectInvalidPng(wrongDeflateType, "non-stored DEFLATE block");

            byte[] wrongWidth = (byte[])valid.Clone();
            ChunkLocation ihdr = FindChunk(wrongWidth, "IHDR");
            WriteUInt32BigEndian(wrongWidth, ihdr.DataOffset, 0U);
            RewriteChunkCrc(wrongWidth, ihdr);
            ExpectInvalidPng(wrongWidth, "zero width");

            byte[] wrongChunkType = (byte[])valid.Clone();
            chromaticity = FindChunk(wrongChunkType, "cHRM");
            byte[] textType = Encoding.ASCII.GetBytes("tEXt");
            Buffer.BlockCopy(textType, 0, wrongChunkType, chromaticity.TypeOffset, 4);
            RewriteChunkCrc(wrongChunkType, chromaticity);
            ExpectInvalidPng(wrongChunkType, "unexpected chunk type");

            var trailing = new byte[valid.Length + 1];
            Buffer.BlockCopy(valid, 0, trailing, 0, valid.Length);
            ExpectInvalidPng(trailing, "trailing byte");

            var truncated = new byte[valid.Length - 1];
            Buffer.BlockCopy(valid, 0, truncated, 0, truncated.Length);
            ExpectInvalidPng(truncated, "truncated IEND");
        }

        private static void TestFullSizePatternRoundTrip()
        {
            const int width = 1600;
            const int height = 900;
            var raw = new byte[width * height * 3];
            for (int y = 0; y < height; y += 1)
            {
                for (int x = 0; x < width; x += 1)
                {
                    int offset = ((y * width) + x) * 3;
                    raw[offset] = (byte)(((x * 17) + (y * 3)) & 255);
                    raw[offset + 1] = (byte)((x ^ y) & 255);
                    raw[offset + 2] = (byte)(((x * 5) + (y * 11)) & 255);
                }
            }
            string rawSha256 = DisplayEncodingPolicy.Sha256Bytes(raw);
            var source = DisplayEncodingPolicy.CreateUnityGammaUnormRgb24(
                width,
                height,
                RasterRowOrigin.LowerLeft,
                raw);

            AssertFullSizeRoundTrip(source, 8);
            AssertFullSizeRoundTrip(source, 16);
            AssertEqual(rawSha256, DisplayEncodingPolicy.Sha256Bytes(raw), "caller raw unchanged");
            AssertEqual(rawSha256, source.Sha256, "owned raw unchanged");
        }

        private static void AssertFullSizeRoundTrip(
            UnityGammaUnormRgb24Frame source,
            int bitDepth)
        {
            SrgbTaggedDisplayFrame display = bitDepth == 8
                ? DisplayEncodingPolicy.MapIdentityToSrgbTagged8(source)
                : DisplayEncodingPolicy.ExpandToSrgbTagged16(source);
            byte[] png = DeterministicPng.Encode(display);
            DeterministicPngVerification verified = DeterministicPng.VerifyAndDecode(
                png,
                RasterRowOrigin.LowerLeft);
            AssertVerificationMetadata(
                verified,
                source.Width,
                source.Height,
                bitDepth);
            AssertEqual(display.Sha256, verified.DecodedFrame.Sha256, "full-size decoded sample hash");
            AssertBytesEqual(
                display.CopySampleBytes(),
                verified.DecodedFrame.CopySampleBytes(),
                "full-size decoded samples");
        }

        private static UnityGammaUnormRgb24Frame CreateTwoByTwoUnityGammaFixture()
        {
            byte[] lowerLeftRgb24 =
            {
                0, 1, 2,
                64, 128, 192,
                255, 254, 128,
                10, 20, 30
            };
            return DisplayEncodingPolicy.CreateUnityGammaUnormRgb24(
                2,
                2,
                RasterRowOrigin.LowerLeft,
                lowerLeftRgb24);
        }

        private static void AssertVerificationMetadata(
            DeterministicPngVerification verification,
            int width,
            int height,
            int bitDepth)
        {
            AssertEqual(width, verification.Width, "verified PNG width");
            AssertEqual(height, verification.Height, "verified PNG height");
            AssertEqual(bitDepth, verification.BitDepth, "verified PNG bit depth");
            AssertEqual(DeterministicPng.SrgbRenderingIntent, verification.RenderingIntent, "sRGB intent");
            AssertEqual(DeterministicPng.SrgbGamma, verification.Gamma, "sRGB gAMA");
            AssertEqual(DeterministicPng.ChunkSequence, String.Join(",", verification.CopyChunkSequence()), "chunk sequence");
            AssertIntArraysEqual(
                DeterministicPng.CopySrgbChromaticities(),
                verification.CopyChromaticities(),
                "sRGB cHRM");
            AssertEqual(true, verification.AllChunkCrcsVerified, "all CRCs verified");
            AssertEqual(true, verification.ZlibStoredBlocksVerified, "stored blocks verified");
            AssertEqual(true, verification.Adler32Verified, "Adler-32 verified");
            AssertEqual(true, verification.FilterZeroVerified, "filter zero verified");
            AssertEqual(true, verification.NoTrailingBytesVerified, "no trailing bytes verified");
            AssertEqual(
                DisplayEncodingPolicy.Sha256Bytes(verification.DecodedFrame.CopySampleBytes()),
                verification.DecodedFrame.Sha256,
                "decoded sample SHA-256");
        }

        private static void AssertRowsReversed(
            byte[] lowerLeft,
            byte[] upperLeft,
            int width,
            int height,
            int bytesPerPixel,
            string label)
        {
            int rowBytes = width * bytesPerPixel;
            if (lowerLeft.Length != upperLeft.Length || lowerLeft.Length != rowBytes * height)
            {
                throw new InvalidOperationException(label + " fixture dimensions are inconsistent.");
            }
            for (int y = 0; y < height; y += 1)
            {
                int leftOffset = y * rowBytes;
                int rightOffset = (height - 1 - y) * rowBytes;
                for (int index = 0; index < rowBytes; index += 1)
                {
                    if (lowerLeft[leftOffset + index] != upperLeft[rightOffset + index])
                    {
                        throw new InvalidOperationException(label + " row mapping differs.");
                    }
                }
            }
        }

        private static void MutateFirstFilterAndRepairChecksums(byte[] png)
        {
            ChunkLocation idat = FindChunk(png, "IDAT");
            int zlibOffset = idat.DataOffset;
            int blockHeaderOffset = zlibOffset + 2;
            if (png[blockHeaderOffset] != 1)
            {
                throw new InvalidOperationException("The 2x2 fixture did not encode as one final stored block.");
            }
            int length = png[blockHeaderOffset + 1] | (png[blockHeaderOffset + 2] << 8);
            int payloadOffset = blockHeaderOffset + 5;
            png[payloadOffset] = 1;
            uint adler = ComputeTestAdler32(png, payloadOffset, length);
            WriteUInt32BigEndian(png, idat.DataOffset + idat.DataLength - 4, adler);
            RewriteChunkCrc(png, idat);
        }

        private static ChunkLocation FindChunk(byte[] png, string expectedType)
        {
            int offset = 8;
            while (offset <= png.Length - 12)
            {
                uint unsignedLength = ReadUInt32BigEndian(png, offset);
                if (unsignedLength > Int32.MaxValue)
                {
                    break;
                }
                int length = (int)unsignedLength;
                if ((long)offset + 12L + length > png.LongLength)
                {
                    break;
                }
                string type = Encoding.ASCII.GetString(png, offset + 4, 4);
                if (String.Equals(type, expectedType, StringComparison.Ordinal))
                {
                    return new ChunkLocation(offset + 4, offset + 8, length);
                }
                offset += 12 + length;
            }
            throw new InvalidOperationException("PNG test chunk not found: " + expectedType);
        }

        private static void RewriteChunkCrc(byte[] png, ChunkLocation chunk)
        {
            uint crc = ComputeTestCrc(png, chunk.TypeOffset, 4 + chunk.DataLength);
            WriteUInt32BigEndian(png, chunk.DataOffset + chunk.DataLength, crc);
        }

        private static uint ComputeTestCrc(byte[] bytes, int offset, int count)
        {
            uint crc = 0xFFFFFFFFU;
            int end = offset + count;
            for (int index = offset; index < end; index += 1)
            {
                crc ^= bytes[index];
                for (int bit = 0; bit < 8; bit += 1)
                {
                    crc = (crc & 1U) != 0
                        ? 0xEDB88320U ^ (crc >> 1)
                        : crc >> 1;
                }
            }
            return crc ^ 0xFFFFFFFFU;
        }

        private static uint ComputeTestAdler32(byte[] bytes, int offset, int count)
        {
            const uint modulus = 65521U;
            uint first = 1U;
            uint second = 0U;
            int end = offset + count;
            for (int index = offset; index < end; index += 1)
            {
                first = (first + bytes[index]) % modulus;
                second = (second + first) % modulus;
            }
            return (second << 16) | first;
        }

        private static ushort ReadUInt16BigEndian(byte[] bytes, int offset)
        {
            return (ushort)((bytes[offset] << 8) | bytes[offset + 1]);
        }

        private static uint ReadUInt32BigEndian(byte[] bytes, int offset)
        {
            return ((uint)bytes[offset] << 24) |
                ((uint)bytes[offset + 1] << 16) |
                ((uint)bytes[offset + 2] << 8) |
                bytes[offset + 3];
        }

        private static void WriteUInt32BigEndian(byte[] bytes, int offset, uint value)
        {
            bytes[offset] = (byte)((value >> 24) & 255U);
            bytes[offset + 1] = (byte)((value >> 16) & 255U);
            bytes[offset + 2] = (byte)((value >> 8) & 255U);
            bytes[offset + 3] = (byte)(value & 255U);
        }

        private static void ExpectInvalidPng(byte[] bytes, string label)
        {
            try
            {
                DeterministicPng.VerifyAndDecode(bytes, RasterRowOrigin.LowerLeft);
            }
            catch (InvalidDataException)
            {
                return;
            }
            throw new InvalidOperationException("Expected invalid PNG rejection: " + label);
        }

        private static void ExpectThrows<TException>(Action action)
            where TException : Exception
        {
            try
            {
                action();
            }
            catch (TException)
            {
                return;
            }
            throw new InvalidOperationException(
                "Expected exception " + typeof(TException).FullName + ".");
        }

        private static void AssertBytesEqual(byte[] expected, byte[] actual, string label)
        {
            if (expected == null || actual == null || expected.Length != actual.Length)
            {
                throw new InvalidOperationException(label + " byte lengths differ.");
            }
            for (int index = 0; index < expected.Length; index += 1)
            {
                if (expected[index] != actual[index])
                {
                    throw new InvalidOperationException(
                        label + " differs at byte " + index.ToString() + ".");
                }
            }
        }

        private static void AssertIntArraysEqual(int[] expected, int[] actual, string label)
        {
            if (expected == null || actual == null || expected.Length != actual.Length)
            {
                throw new InvalidOperationException(label + " lengths differ.");
            }
            for (int index = 0; index < expected.Length; index += 1)
            {
                if (expected[index] != actual[index])
                {
                    throw new InvalidOperationException(label + " differs at index " + index.ToString() + ".");
                }
            }
        }

        private static void AssertEqual<T>(T expected, T actual, string label)
        {
            if (!Object.Equals(expected, actual))
            {
                throw new InvalidOperationException(
                    label + " expected " + expected + " but received " + actual + ".");
            }
        }

        private struct ChunkLocation
        {
            internal ChunkLocation(int typeOffset, int dataOffset, int dataLength)
            {
                TypeOffset = typeOffset;
                DataOffset = dataOffset;
                DataLength = dataLength;
            }

            internal int TypeOffset;
            internal int DataOffset;
            internal int DataLength;
        }
    }
}
