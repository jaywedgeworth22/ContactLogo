import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif

/// A small, dependency-free SVG reader for the shapes our sources actually
/// emit: `PreferredMarksSource` data URLs (polygons) and Simple Icons glyphs
/// (one `<path>` in a 24×24 viewBox).  It is deliberately not a general SVG
/// engine — no CSS, no gradients, no nested transforms — because the only job
/// is turning a curated vector mark into pixels so it can be padded, written
/// to Contacts, and measured for the square rule (ENGINE-CONTRACT R11.4).
enum SVGRasterizer {

    /// Cheap sniff: does this payload look like SVG/XML markup?
    static func looksLikeSVG(_ data: Data) -> Bool {
        guard !data.isEmpty else { return false }
        let head = String(decoding: data.prefix(2048), as: UTF8.self).lowercased()
        return head.contains("<svg")
    }

    private static let elementRegex = try! NSRegularExpression(
        pattern: #"<(path|polygon|polyline|rect|circle|ellipse)\b([^>]*)>"#,
        options: [.caseInsensitive, .dotMatchesLineSeparators]
    )
    private static let rootRegex = try! NSRegularExpression(
        pattern: #"<svg\b([^>]*)>"#,
        options: [.caseInsensitive, .dotMatchesLineSeparators]
    )
    private static let attributeRegex = try! NSRegularExpression(
        pattern: #"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')"#,
        options: [.dotMatchesLineSeparators]
    )

    static func attributes(in fragment: String) -> [String: String] {
        var out: [String: String] = [:]
        let ns = fragment as NSString
        let matches = attributeRegex.matches(in: fragment, range: NSRange(location: 0, length: ns.length))
        for match in matches {
            let name = ns.substring(with: match.range(at: 1)).lowercased()
            var value = ""
            if match.range(at: 2).location != NSNotFound {
                value = ns.substring(with: match.range(at: 2))
            } else if match.range(at: 3).location != NSNotFound {
                value = ns.substring(with: match.range(at: 3))
            }
            if out[name] == nil { out[name] = value }
        }
        return out
    }

    /// Numbers from a whitespace/comma separated attribute ("0 0 24 24").
    static func numbers(_ value: String) -> [Double] {
        value.split { $0 == " " || $0 == "," || $0 == "\n" || $0 == "\t" || $0 == "\r" }
            .compactMap { Double($0) }
    }

    #if canImport(CoreGraphics)

    struct Shape {
        let path: CGPath
        let fill: CGColor
        let evenOdd: Bool
    }

    struct Document {
        let viewBox: CGRect
        let shapes: [Shape]
    }

    /// The paint properties SVG inherits down the tree.  We carry them from the
    /// root `<svg>` only, which is all our sources need: Simple Icons puts the
    /// brand colour on the root and leaves the glyph's `<path>` bare, so without
    /// this every one of those marks rasterizes black (ENGINE-CONTRACT R11.4 —
    /// the preview and the written image must be the same picture).
    struct Inherited {
        var fill: String?
        var fillOpacity: String?
    }

    static func parse(_ data: Data) -> Document? {
        let text = String(decoding: data, as: UTF8.self)
        let ns = text as NSString
        let full = NSRange(location: 0, length: ns.length)

        var viewBox = CGRect(x: 0, y: 0, width: 0, height: 0)
        var inherited = Inherited()
        if let root = rootRegex.firstMatch(in: text, range: full) {
            let attrs = attributes(in: ns.substring(with: root.range))
            inherited = Inherited(fill: attrs["fill"], fillOpacity: attrs["fill-opacity"])
            if let box = attrs["viewbox"] {
                let v = numbers(box)
                if v.count == 4, v[2] > 0, v[3] > 0 {
                    viewBox = CGRect(x: CGFloat(v[0]), y: CGFloat(v[1]), width: CGFloat(v[2]), height: CGFloat(v[3]))
                }
            }
            if viewBox.width <= 0 || viewBox.height <= 0 {
                let w = numbers(attrs["width"] ?? "").first ?? 0
                let h = numbers(attrs["height"] ?? "").first ?? 0
                if w > 0, h > 0 { viewBox = CGRect(x: 0, y: 0, width: CGFloat(w), height: CGFloat(h)) }
            }
        }
        guard viewBox.width > 0, viewBox.height > 0 else { return nil }

        var shapes: [Shape] = []
        for match in elementRegex.matches(in: text, range: full) {
            let tag = ns.substring(with: match.range(at: 1)).lowercased()
            let attrs = attributes(in: ns.substring(with: match.range))
            guard let fill = fillColor(attrs, inheriting: inherited) else { continue }
            guard let path = path(forTag: tag, attributes: attrs) else { continue }
            shapes.append(Shape(path: path, fill: fill, evenOdd: (attrs["fill-rule"] ?? "") == "evenodd"))
        }
        guard !shapes.isEmpty else { return nil }
        return Document(viewBox: viewBox, shapes: shapes)
    }

    /// Draw `doc` centred inside `box`, preserving aspect ratio, flipping the
    /// SVG y-down coordinate system into CoreGraphics' y-up one.
    static func draw(_ doc: Document, in context: CGContext, box: CGRect) -> Bool {
        guard doc.viewBox.width > 0, doc.viewBox.height > 0, !doc.shapes.isEmpty else { return false }
        let scale = min(box.width / doc.viewBox.width, box.height / doc.viewBox.height)
        guard scale > 0 else { return false }
        let offsetX = box.midX - doc.viewBox.width * scale / 2
        let offsetY = box.midY - doc.viewBox.height * scale / 2
        var transform = CGAffineTransform(a: scale, b: 0, c: 0, d: -scale,
                                          tx: offsetX - scale * doc.viewBox.minX,
                                          ty: offsetY + scale * doc.viewBox.maxY)
        var drew = false
        for shape in doc.shapes {
            guard let transformed = shape.path.copy(using: &transform) else { continue }
            context.addPath(transformed)
            context.setFillColor(shape.fill)
            context.fillPath(using: shape.evenOdd ? .evenOdd : .winding)
            drew = true
        }
        return drew
    }

    // MARK: - Shapes

    static func path(forTag tag: String, attributes attrs: [String: String]) -> CGPath? {
        switch tag {
        case "path":
            guard let d = attrs["d"], !d.isEmpty else { return nil }
            let path = parsePathData(d)
            return path.isEmpty ? nil : path
        case "polygon", "polyline":
            let v = numbers(attrs["points"] ?? "")
            guard v.count >= 4 else { return nil }
            let path = CGMutablePath()
            path.move(to: CGPoint(x: v[0], y: v[1]))
            var i = 2
            while i + 1 < v.count {
                path.addLine(to: CGPoint(x: v[i], y: v[i + 1]))
                i += 2
            }
            if tag == "polygon" { path.closeSubpath() }
            return path
        case "rect":
            let x = numbers(attrs["x"] ?? "0").first ?? 0
            let y = numbers(attrs["y"] ?? "0").first ?? 0
            guard let w = numbers(attrs["width"] ?? "").first, let h = numbers(attrs["height"] ?? "").first,
                  w > 0, h > 0 else { return nil }
            let path = CGMutablePath()
            path.addRect(CGRect(x: x, y: y, width: w, height: h))
            return path
        case "circle":
            let cx = numbers(attrs["cx"] ?? "0").first ?? 0
            let cy = numbers(attrs["cy"] ?? "0").first ?? 0
            guard let r = numbers(attrs["r"] ?? "").first, r > 0 else { return nil }
            let path = CGMutablePath()
            path.addEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
            return path
        case "ellipse":
            let cx = numbers(attrs["cx"] ?? "0").first ?? 0
            let cy = numbers(attrs["cy"] ?? "0").first ?? 0
            guard let rx = numbers(attrs["rx"] ?? "").first, let ry = numbers(attrs["ry"] ?? "").first,
                  rx > 0, ry > 0 else { return nil }
            let path = CGMutablePath()
            path.addEllipse(in: CGRect(x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2))
            return path
        default:
            return nil
        }
    }

    // MARK: - Colour

    static let namedColors: [String: String] = [
        "black": "#000000", "white": "#ffffff", "red": "#ff0000", "green": "#008000",
        "blue": "#0000ff", "yellow": "#ffff00", "orange": "#ffa500", "gray": "#808080",
        "grey": "#808080", "silver": "#c0c0c0", "navy": "#000080", "teal": "#008080",
        "purple": "#800080", "maroon": "#800000", "lime": "#00ff00", "aqua": "#00ffff",
        "cyan": "#00ffff", "magenta": "#ff00ff", "fuchsia": "#ff00ff", "olive": "#808000"
    ]

    /// The fill for an element, or nil when it paints nothing.  `fill` and
    /// `fill-opacity` fall back to whatever the root `<svg>` declared before
    /// SVG's initial value of opaque black applies; `opacity` is a group
    /// property and does not inherit.
    static func fillColor(_ attrs: [String: String], inheriting inherited: Inherited = Inherited()) -> CGColor? {
        var alpha = 1.0
        if let o = numbers(attrs["opacity"] ?? "").first { alpha *= max(0, min(1, o)) }
        if let o = numbers(attrs["fill-opacity"] ?? inherited.fillOpacity ?? "").first {
            alpha *= max(0, min(1, o))
        }
        guard alpha > 0 else { return nil }
        guard let raw = attrs["fill"] ?? inherited.fill else {
            return CGColor(srgbRed: 0, green: 0, blue: 0, alpha: CGFloat(alpha))
        }
        return color(raw, alpha: alpha)
    }

    static func color(_ raw: String, alpha: Double) -> CGColor? {
        var value = raw.trimmingCharacters(in: .whitespaces).lowercased()
        if value.isEmpty || value == "none" || value == "transparent" { return nil }
        if value == "currentcolor" { value = "#000000" }
        if let named = namedColors[value] { value = named }

        if value.hasPrefix("rgb(") && value.hasSuffix(")") {
            let inner = String(value.dropFirst(4).dropLast())
            let parts = numbers(inner.replacingOccurrences(of: "%", with: ""))
            guard parts.count >= 3 else { return nil }
            return CGColor(srgbRed: CGFloat(parts[0] / 255), green: CGFloat(parts[1] / 255),
                           blue: CGFloat(parts[2] / 255), alpha: CGFloat(alpha))
        }
        guard value.hasPrefix("#") else { return nil }
        var hex = String(value.dropFirst())
        if hex.count == 3 {
            hex = hex.map { "\($0)\($0)" }.joined()
        }
        guard hex.count == 6, let bits = UInt32(hex, radix: 16) else { return nil }
        let r = CGFloat((bits >> 16) & 0xFF) / 255
        let g = CGFloat((bits >> 8) & 0xFF) / 255
        let b = CGFloat(bits & 0xFF) / 255
        return CGColor(srgbRed: r, green: g, blue: b, alpha: CGFloat(alpha))
    }

    // MARK: - Path data

    /// Scans SVG path data: numbers, command letters, and the single-digit
    /// arc flags (which may be packed with no separator, "a1 1 0 011 1").
    struct PathScanner {
        private let chars: [Character]
        private var index = 0

        init(_ text: String) { chars = Array(text) }

        var atEnd: Bool { index >= chars.count }

        mutating func skipSeparators() {
            while index < chars.count {
                let c = chars[index]
                if c == " " || c == "," || c == "\n" || c == "\r" || c == "\t" { index += 1 } else { break }
            }
        }

        mutating func nextCommand() -> Character? {
            skipSeparators()
            guard index < chars.count else { return nil }
            let c = chars[index]
            guard c.isLetter else { return nil }
            index += 1
            return c
        }

        mutating func nextFlag() -> Bool? {
            skipSeparators()
            guard index < chars.count else { return nil }
            let c = chars[index]
            if c == "0" { index += 1; return false }
            if c == "1" { index += 1; return true }
            return nil
        }

        mutating func nextNumber() -> Double? {
            skipSeparators()
            var text = ""
            var sawDigit = false
            if index < chars.count, chars[index] == "+" || chars[index] == "-" {
                text.append(chars[index]); index += 1
            }
            while index < chars.count, isDigit(chars[index]) {
                text.append(chars[index]); index += 1; sawDigit = true
            }
            if index < chars.count, chars[index] == "." {
                text.append(chars[index]); index += 1
                while index < chars.count, isDigit(chars[index]) {
                    text.append(chars[index]); index += 1; sawDigit = true
                }
            }
            guard sawDigit else { return nil }
            if index < chars.count, chars[index] == "e" || chars[index] == "E" {
                var lookahead = index + 1
                var exponent = "e"
                if lookahead < chars.count, chars[lookahead] == "+" || chars[lookahead] == "-" {
                    exponent.append(chars[lookahead]); lookahead += 1
                }
                var sawExponentDigit = false
                while lookahead < chars.count, isDigit(chars[lookahead]) {
                    exponent.append(chars[lookahead]); lookahead += 1; sawExponentDigit = true
                }
                if sawExponentDigit { text += exponent; index = lookahead }
            }
            return Double(text)
        }

        private func isDigit(_ c: Character) -> Bool { c.isASCII && c.isNumber }
    }

    static func parsePathData(_ d: String) -> CGMutablePath {
        let path = CGMutablePath()
        var scanner = PathScanner(d)
        var current = CGPoint.zero
        var subpathStart = CGPoint.zero
        var lastCubicControl: CGPoint?
        var lastQuadControl: CGPoint?
        var command: Character = " "
        var open = false
        var steps = 0

        func ensureOpen() {
            if !open {
                path.move(to: current)
                subpathStart = current
                open = true
            }
        }

        while true {
            steps += 1
            if steps > 100_000 { break }
            scanner.skipSeparators()
            if scanner.atEnd { break }
            if let next = scanner.nextCommand() { command = next }
            let relative = command.isLowercase
            let base = relative ? current : CGPoint.zero

            switch command {
            case "M", "m":
                guard let x = scanner.nextNumber(), let y = scanner.nextNumber() else { return path }
                current = CGPoint(x: base.x + CGFloat(x), y: base.y + CGFloat(y))
                path.move(to: current)
                subpathStart = current
                open = true
                command = relative ? "l" : "L"   // implicit lineto for further pairs
                lastCubicControl = nil; lastQuadControl = nil
            case "L", "l":
                guard let x = scanner.nextNumber(), let y = scanner.nextNumber() else { return path }
                ensureOpen()
                current = CGPoint(x: base.x + CGFloat(x), y: base.y + CGFloat(y))
                path.addLine(to: current)
                lastCubicControl = nil; lastQuadControl = nil
            case "H", "h":
                guard let x = scanner.nextNumber() else { return path }
                ensureOpen()
                current = CGPoint(x: base.x + CGFloat(x), y: current.y)
                path.addLine(to: current)
                lastCubicControl = nil; lastQuadControl = nil
            case "V", "v":
                guard let y = scanner.nextNumber() else { return path }
                ensureOpen()
                current = CGPoint(x: current.x, y: base.y + CGFloat(y))
                path.addLine(to: current)
                lastCubicControl = nil; lastQuadControl = nil
            case "C", "c":
                guard let x1 = scanner.nextNumber(), let y1 = scanner.nextNumber(),
                      let x2 = scanner.nextNumber(), let y2 = scanner.nextNumber(),
                      let x = scanner.nextNumber(), let y = scanner.nextNumber() else { return path }
                ensureOpen()
                let c1 = CGPoint(x: base.x + CGFloat(x1), y: base.y + CGFloat(y1))
                let c2 = CGPoint(x: base.x + CGFloat(x2), y: base.y + CGFloat(y2))
                current = CGPoint(x: base.x + CGFloat(x), y: base.y + CGFloat(y))
                path.addCurve(to: current, control1: c1, control2: c2)
                lastCubicControl = c2; lastQuadControl = nil
            case "S", "s":
                guard let x2 = scanner.nextNumber(), let y2 = scanner.nextNumber(),
                      let x = scanner.nextNumber(), let y = scanner.nextNumber() else { return path }
                ensureOpen()
                let previous = lastCubicControl ?? current
                let c1 = CGPoint(x: current.x * 2 - previous.x, y: current.y * 2 - previous.y)
                let c2 = CGPoint(x: base.x + CGFloat(x2), y: base.y + CGFloat(y2))
                current = CGPoint(x: base.x + CGFloat(x), y: base.y + CGFloat(y))
                path.addCurve(to: current, control1: c1, control2: c2)
                lastCubicControl = c2; lastQuadControl = nil
            case "Q", "q":
                guard let x1 = scanner.nextNumber(), let y1 = scanner.nextNumber(),
                      let x = scanner.nextNumber(), let y = scanner.nextNumber() else { return path }
                ensureOpen()
                let c = CGPoint(x: base.x + CGFloat(x1), y: base.y + CGFloat(y1))
                current = CGPoint(x: base.x + CGFloat(x), y: base.y + CGFloat(y))
                path.addQuadCurve(to: current, control: c)
                lastQuadControl = c; lastCubicControl = nil
            case "T", "t":
                guard let x = scanner.nextNumber(), let y = scanner.nextNumber() else { return path }
                ensureOpen()
                let previous = lastQuadControl ?? current
                let c = CGPoint(x: current.x * 2 - previous.x, y: current.y * 2 - previous.y)
                current = CGPoint(x: base.x + CGFloat(x), y: base.y + CGFloat(y))
                path.addQuadCurve(to: current, control: c)
                lastQuadControl = c; lastCubicControl = nil
            case "A", "a":
                guard let rx = scanner.nextNumber(), let ry = scanner.nextNumber(),
                      let rotation = scanner.nextNumber(), let largeArc = scanner.nextFlag(),
                      let sweep = scanner.nextFlag(),
                      let x = scanner.nextNumber(), let y = scanner.nextNumber() else { return path }
                ensureOpen()
                let end = CGPoint(x: base.x + CGFloat(x), y: base.y + CGFloat(y))
                addArc(path, from: current, to: end, rx: CGFloat(rx), ry: CGFloat(ry),
                       rotationDegrees: rotation, largeArc: largeArc, sweep: sweep)
                current = end
                lastCubicControl = nil; lastQuadControl = nil
            case "Z", "z":
                if open { path.closeSubpath() }
                current = subpathStart
                command = " "
                lastCubicControl = nil; lastQuadControl = nil
            default:
                return path
            }
        }
        return path
    }

    /// SVG endpoint-parameterised elliptical arc → centre parameterisation,
    /// drawn as a unit-circle arc under a scale/rotate/translate transform.
    static func addArc(_ path: CGMutablePath, from p0: CGPoint, to p1: CGPoint,
                       rx rxIn: CGFloat, ry ryIn: CGFloat, rotationDegrees: Double,
                       largeArc: Bool, sweep: Bool) {
        var rx = abs(rxIn), ry = abs(ryIn)
        if rx == 0 || ry == 0 || (p0.x == p1.x && p0.y == p1.y) {
            path.addLine(to: p1)
            return
        }
        let phi = rotationDegrees * Double.pi / 180
        let cosPhi = CGFloat(cos(phi)), sinPhi = CGFloat(sin(phi))
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1 = cosPhi * dx + sinPhi * dy
        let y1 = -sinPhi * dx + cosPhi * dy

        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 {
            let correction = lambda.squareRoot()
            rx *= correction
            ry *= correction
        }
        let rx2 = rx * rx, ry2 = ry * ry
        let numerator = max(0, rx2 * ry2 - rx2 * y1 * y1 - ry2 * x1 * x1)
        let denominator = rx2 * y1 * y1 + ry2 * x1 * x1
        let magnitude = denominator > 0 ? (numerator / denominator).squareRoot() : 0
        let coefficient = (largeArc != sweep) ? magnitude : -magnitude
        let cxp = coefficient * rx * y1 / ry
        let cyp = -coefficient * ry * x1 / rx
        let cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2

        let ux = (x1 - cxp) / rx, uy = (y1 - cyp) / ry
        let vx = (-x1 - cxp) / rx, vy = (-y1 - cyp) / ry
        let start = angle(1, 0, ux, uy)
        var delta = angle(ux, uy, vx, vy)
        if !sweep, delta > 0 { delta -= 2 * CGFloat.pi }
        if sweep, delta < 0 { delta += 2 * CGFloat.pi }

        let transform = CGAffineTransform(translationX: cx, y: cy)
            .rotated(by: CGFloat(phi))
            .scaledBy(x: rx, y: ry)
        path.addArc(center: .zero, radius: 1, startAngle: start, endAngle: start + delta,
                    clockwise: delta < 0, transform: transform)
    }

    static func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
        let dot = Double(ux * vx + uy * vy)
        let length = Double((ux * ux + uy * uy) * (vx * vx + vy * vy)).squareRoot()
        guard length > 0 else { return 0 }
        let cosine = max(-1, min(1, dot / length))
        let sign: Double = (ux * vy - uy * vx) < 0 ? -1 : 1
        return CGFloat(sign * acos(cosine))
    }
    #endif
}
