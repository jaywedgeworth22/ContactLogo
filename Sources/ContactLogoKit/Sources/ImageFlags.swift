import Foundation
#if canImport(CoreGraphics) && canImport(ImageIO)
import CoreGraphics
import ImageIO
#endif

/// vendor/crest image-flags: detect transparency without rendering, score
/// iconic marks above opaque JPEG wordmarks, and reject provider letter tiles
/// (ENGINE-CONTRACT R11.5).
public enum ImageFlags {

    public static func hasAlpha(_ data: Data, contentType: String? = nil) -> Bool {
        let type = (contentType ?? "").lowercased()
        if type.contains("svg") { return true }
        if type.contains("jpeg") || type.contains("jpg") || type.contains("icon") { return false }
        if type.contains("png") || isPNG(data) { return pngHasAlpha(data) }
        return false
    }

    public static func isPNG(_ data: Data) -> Bool {
        data.count >= 24 && data.starts(with: [0x89, 0x50, 0x4E, 0x47])
    }

    public static func isJPEG(_ data: Data) -> Bool {
        data.count >= 4 && data[data.startIndex] == 0xFF && data[data.startIndex + 1] == 0xD8
    }

    public static func isGIF(_ data: Data) -> Bool {
        data.count >= 6 && data.starts(with: Array("GIF8".utf8))
    }

    /// A raster payload we can reason about by byte count.
    public static func isRaster(_ data: Data) -> Bool {
        isPNG(data) || isJPEG(data) || isGIF(data)
    }

    /// PNG color type 4/6 or a tRNS chunk means the asset can sit on a contact card.
    public static func pngHasAlpha(_ data: Data) -> Bool {
        guard data.count >= 26 else { return false }
        let colorType = data[25]
        if colorType == 4 || colorType == 6 { return true }
        var offset = 8
        while offset + 8 <= data.count {
            let length = Int(data[offset]) << 24 | Int(data[offset + 1]) << 16
                | Int(data[offset + 2]) << 8 | Int(data[offset + 3])
            let name = String(bytes: data[offset + 4 ..< offset + 8], encoding: .ascii) ?? ""
            if name == "tRNS" { return true }
            if name == "IEND" { break }
            let next = offset + 12 + length
            if next <= offset { break }
            offset = next
        }
        return false
    }

    /// Empty / truncated payload: not an image at all.
    public static func isTooSmall(_ data: Data) -> Bool {
        data.count < 80
    }

    /// R11.5 step 2 — nothing under 512 bytes of raster is a usable logo.
    /// Vector payloads are exempt: a curated SVG mark is often ~400 bytes.
    public static let rasterByteFloor = 512

    /// R11.5 step 1 — Brandfetch's Logo Link CDN marks its letter tiles with a
    /// response header; the Brand API marks them in JSON.
    public static func isProviderFallback(headerValue: String?) -> Bool {
        guard let value = headerValue?.trimmingCharacters(in: .whitespaces).lowercased(), !value.isEmpty else {
            return false
        }
        return value == "true" || value == "1" || value == "yes"
    }

    /// R11.5 — a letter tile is one centred glyph in one colour on a flat
    /// field.  A real mark reaches the edges, uses more colours, or is
    /// off-centre.  A tile is dropped exactly as if the fetch had 404'd.
    ///
    /// Constants are fixed by the contract so a tile rejected on macOS is also
    /// rejected in the web and Android engines.
    public static func isFallbackTile(_ data: Data, providerFlagged: Bool = false) -> Bool {
        if providerFlagged { return true }
        if isRaster(data), data.count < rasterByteFloor { return true }
        return looksLikeCentredGlyph(data)
    }

    // MARK: - Pixel test

    static let tileMaxEdge = 64
    static let tileCornerBlock = 8
    static let tileBackgroundTolerance = 8
    static let tileInkThreshold = 32
    static let tileMinInkFraction = 0.02
    static let tileMaxInkFraction = 0.22
    static let tileMaxCentreOffset = 0.12
    static let tileMaxSpan = 0.55
    static let tileMaxInkColours = 2

    #if canImport(CoreGraphics) && canImport(ImageIO)
    static func looksLikeCentredGlyph(_ data: Data) -> Bool {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              image.width > 0, image.height > 0 else { return false }

        let scale = min(Double(tileMaxEdge) / Double(image.width),
                        Double(tileMaxEdge) / Double(image.height), 1.0)
        let width = max(tileCornerBlock * 2, Int((Double(image.width) * scale).rounded()))
        let height = max(tileCornerBlock * 2, Int((Double(image.height) * scale).rounded()))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: width * 4, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.interpolationQuality = .none
        context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        guard let raw = context.data else { return false }

        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        pixels.withUnsafeMutableBytes { buffer in
            if let base = buffer.baseAddress {
                base.copyMemory(from: raw, byteCount: width * height * 4)
            }
        }
        return isCentredGlyph(pixels: pixels, width: width, height: height)
    }
    #else
    static func looksLikeCentredGlyph(_ data: Data) -> Bool { false }
    #endif

    /// Pure pixel arithmetic, split out so it can be tested without a decoder.
    /// `pixels` is RGBA8, row-major, `width * height * 4` bytes.
    static func isCentredGlyph(pixels: [UInt8], width: Int, height: Int) -> Bool {
        guard width >= tileCornerBlock * 2, height >= tileCornerBlock * 2,
              pixels.count == width * height * 4 else { return false }

        func channel(_ x: Int, _ y: Int, _ c: Int) -> Int { Int(pixels[(y * width + x) * 4 + c]) }

        func blockMean(_ originX: Int, _ originY: Int) -> [Int] {
            var sums = [0, 0, 0]
            for y in originY..<(originY + tileCornerBlock) {
                for x in originX..<(originX + tileCornerBlock) {
                    for c in 0..<3 { sums[c] += channel(x, y, c) }
                }
            }
            let count = tileCornerBlock * tileCornerBlock
            return sums.map { $0 / count }
        }

        let corners = [
            blockMean(0, 0),
            blockMean(width - tileCornerBlock, 0),
            blockMean(0, height - tileCornerBlock),
            blockMean(width - tileCornerBlock, height - tileCornerBlock)
        ]
        var background = [0, 0, 0]
        for corner in corners {
            for c in 0..<3 { background[c] += corner[c] }
        }
        for c in 0..<3 { background[c] /= corners.count }

        for corner in corners {
            for c in 0..<3 where abs(corner[c] - background[c]) > tileBackgroundTolerance {
                return false // four flat identical corners are the tile signature
            }
        }

        var inkCount = 0
        var minX = width, minY = height, maxX = -1, maxY = -1
        var quantised = Set<Int>()
        for y in 0..<height {
            for x in 0..<width {
                var isInk = false
                for c in 0..<3 where abs(channel(x, y, c) - background[c]) > tileInkThreshold { isInk = true }
                guard isInk else { continue }
                inkCount += 1
                if x < minX { minX = x }
                if x > maxX { maxX = x }
                if y < minY { minY = y }
                if y > maxY { maxY = y }
                let key = (channel(x, y, 0) >> 3) << 10 | (channel(x, y, 1) >> 3) << 5 | (channel(x, y, 2) >> 3)
                if quantised.count <= tileMaxInkColours { quantised.insert(key) }
            }
        }
        guard inkCount > 0, maxX >= minX, maxY >= minY else { return false }

        let fraction = Double(inkCount) / Double(width * height)
        guard fraction >= tileMinInkFraction, fraction <= tileMaxInkFraction else { return false }

        let spanX = Double(maxX - minX + 1) / Double(width)
        let spanY = Double(maxY - minY + 1) / Double(height)
        guard spanX <= tileMaxSpan, spanY <= tileMaxSpan else { return false }

        let centreX = (Double(minX + maxX) / 2 + 0.5) / Double(width)
        let centreY = (Double(minY + maxY) / 2 + 0.5) / Double(height)
        guard abs(centreX - 0.5) <= tileMaxCentreOffset, abs(centreY - 0.5) <= tileMaxCentreOffset else { return false }

        return quantised.count <= tileMaxInkColours
    }
}
