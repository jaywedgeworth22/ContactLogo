import Foundation
#if canImport(CoreGraphics) && canImport(ImageIO)
import CoreGraphics
import ImageIO
#endif

/// Rasterizes a fetched candidate image to a padded, square PNG suitable for
/// `CNContact.imageData` — the native equivalent of the web canvas path
/// (`padAndSquareImage` in web/src/engine/logos.ts).
///
/// MATCHING-ENGINE §5.3 is "pad, never crop": the mark keeps its aspect ratio
/// and gains transparent margin, so a wide wordmark is letterboxed rather than
/// having its ends cut off.  Rasterizing here is also what lets a vector mark
/// report real pixel dimensions, satisfy the square rule, and reach `.high`
/// (ENGINE-CONTRACT R11.4) — SVG candidates could never do that before.
public enum ImagePreparer {

    public enum Error: Swift.Error, Sendable {
        /// The source bytes could not be decoded as a raster image or SVG.
        case undecodable
        /// Decoded but rasterization/encoding to PNG failed.
        case renderFailed
    }

    /// Output edge length in points. Matches the web default (512×512).
    public static let outputSize: CGFloat = 512
    /// Matches web's 15% safe margin for circular contact icons.
    public static let paddingFraction: CGFloat = 0.15

    /// True when `data` is a vector payload that must be rasterized before it
    /// can be written or measured.
    public static func isVector(_ data: Data) -> Bool {
        SVGRasterizer.looksLikeSVG(data)
    }

    /// Decodes `data` (PNG/JPEG/WebP raster, or SVG), draws it centred with
    /// `paddingFraction` margin onto a transparent `outputSize`×`outputSize`
    /// canvas preserving aspect ratio, and returns PNG bytes plus the pixel
    /// dimensions actually written.
    ///
    /// Throws rather than ever returning raw or undersized bytes — callers
    /// must not fall back to unprepared data.
    public static func squarePNG(from data: Data) throws -> (data: Data, width: Int, height: Int) {
        #if canImport(CoreGraphics) && canImport(ImageIO)
        guard !data.isEmpty else { throw Error.undecodable }
        let side = Int(outputSize)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8,
                                      bytesPerRow: side * 4, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw Error.renderFailed
        }
        context.interpolationQuality = .high
        let inset = outputSize * paddingFraction
        let box = CGRect(x: inset, y: inset, width: outputSize - inset * 2, height: outputSize - inset * 2)

        if isVector(data) {
            guard let document = SVGRasterizer.parse(data) else { throw Error.undecodable }
            guard SVGRasterizer.draw(document, in: context, box: box) else { throw Error.renderFailed }
        } else {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
                  image.width > 0, image.height > 0 else { throw Error.undecodable }
            let width = CGFloat(image.width), height = CGFloat(image.height)
            let scale = min(box.width / width, box.height / height)
            let drawWidth = width * scale, drawHeight = height * scale
            context.draw(image, in: CGRect(x: box.midX - drawWidth / 2, y: box.midY - drawHeight / 2,
                                           width: drawWidth, height: drawHeight))
        }

        guard let rendered = context.makeImage() else { throw Error.renderFailed }
        let buffer = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(buffer as CFMutableData, "public.png" as CFString, 1, nil) else {
            throw Error.renderFailed
        }
        CGImageDestinationAddImage(destination, rendered, nil)
        guard CGImageDestinationFinalize(destination) else { throw Error.renderFailed }
        return (buffer as Data, side, side)
        #else
        throw Error.renderFailed
        #endif
    }

    /// A `data:` URL carrying prepared PNG bytes — how a manual pick is handed
    /// back to the review UI as an ordinary candidate.
    public static func dataURL(png: Data) -> URL? {
        URL(string: "data:image/png;base64,\(png.base64EncodedString())")
    }
}
