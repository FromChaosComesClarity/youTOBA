import AppKit
import CoreGraphics

// Draws the app icon (rounded-square tile, play-triangle + corner-bracket
// glyph) and the mac menu-bar tray glyph (monochrome template) at every
// size macOS asks for. An original mark — not YouTube's logo — same
// approach WhatsTheFuck used to avoid shipping WhatsApp's artwork.
// Run with: swift make-icons.swift <outDir>

guard CommandLine.arguments.count > 1 else {
    print("usage: swift make-icons.swift <outDir>")
    exit(1)
}
let outDir = CommandLine.arguments[1]
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

func savePNG(_ image: NSImage, size: Int, to path: String) {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0
    )!
    rep.size = NSSize(width: size, height: size)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
    NSGraphicsContext.restoreGraphicsState()

    let data = rep.representation(using: .png, properties: [:])!
    try? data.write(to: URL(fileURLWithPath: path))
}

// MARK: - App icon: near-black squircle tile, red play-triangle, two corner
// brackets (viewfinder/TV-framing motif) hinting at the Desktop/TV toggle.

func drawAppIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    guard let ctx = NSGraphicsContext.current?.cgContext else { return image }

    let rect = CGRect(x: 0, y: 0, width: size, height: size)
    let corner = size * 0.2237 // Big Sur–style squircle radius

    let bg = CGPath(roundedRect: rect, cornerWidth: corner, cornerHeight: corner, transform: nil)
    ctx.addPath(bg)
    ctx.clip()

    let colors = [
        CGColor(red: 0.07, green: 0.05, blue: 0.05, alpha: 1),
        CGColor(red: 0.16, green: 0.03, blue: 0.03, alpha: 1),
    ]
    let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(
        gradient,
        start: CGPoint(x: 0, y: size),
        end: CGPoint(x: size, y: 0),
        options: []
    )

    // soft radial highlight, upper-left, no hard edges
    let sheenColors = [
        CGColor(red: 1, green: 1, blue: 1, alpha: 0.08),
        CGColor(red: 1, green: 1, blue: 1, alpha: 0),
    ]
    let sheenGradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: sheenColors as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(
        sheenGradient,
        startCenter: CGPoint(x: size * 0.32, y: size * 0.78), startRadius: 0,
        endCenter: CGPoint(x: size * 0.32, y: size * 0.78), endRadius: size * 0.62,
        options: []
    )

    // corner brackets — viewfinder/TV-framing motif, thin red strokes
    ctx.setStrokeColor(CGColor(red: 1, green: 0.15, blue: 0.15, alpha: 0.9))
    let strokeW = size * 0.028
    ctx.setLineWidth(strokeW)
    ctx.setLineCap(.round)
    let bracketLen = size * 0.16
    let inset = size * 0.16

    // top-left
    ctx.move(to: CGPoint(x: inset, y: size - inset - bracketLen))
    ctx.addLine(to: CGPoint(x: inset, y: size - inset))
    ctx.addLine(to: CGPoint(x: inset + bracketLen, y: size - inset))
    ctx.strokePath()

    // bottom-right
    ctx.move(to: CGPoint(x: size - inset, y: inset + bracketLen))
    ctx.addLine(to: CGPoint(x: size - inset, y: inset))
    ctx.addLine(to: CGPoint(x: size - inset - bracketLen, y: inset))
    ctx.strokePath()

    // play triangle, centered, pointing right
    let triH = size * 0.34
    let triW = triH * 0.86
    let cx = size / 2 + size * 0.02
    let cy = size / 2
    let tri = CGMutablePath()
    tri.move(to: CGPoint(x: cx - triW / 2, y: cy + triH / 2))
    tri.addLine(to: CGPoint(x: cx - triW / 2, y: cy - triH / 2))
    tri.addLine(to: CGPoint(x: cx + triW / 2, y: cy))
    tri.closeSubpath()

    ctx.setFillColor(CGColor(red: 1, green: 0.13, blue: 0.13, alpha: 1))
    ctx.addPath(tri)
    ctx.fillPath()

    image.unlockFocus()
    return image
}

let iconSizes: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]
for (name, px) in iconSizes {
    let img = drawAppIcon(size: CGFloat(px))
    savePNG(img, size: px, to: "\(outDir)/\(name).png")
}

// MARK: - Menu bar tray glyph: monochrome template (play triangle only).

func drawTrayGlyph(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    guard let ctx = NSGraphicsContext.current?.cgContext else { return image }

    let triH = size * 0.62
    let triW = triH * 0.86
    let cx = size / 2 + size * 0.02
    let cy = size / 2
    let tri = CGMutablePath()
    tri.move(to: CGPoint(x: cx - triW / 2, y: cy + triH / 2))
    tri.addLine(to: CGPoint(x: cx - triW / 2, y: cy - triH / 2))
    tri.addLine(to: CGPoint(x: cx + triW / 2, y: cy))
    tri.closeSubpath()

    ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
    ctx.addPath(tri)
    ctx.fillPath()

    image.unlockFocus()
    return image
}

let traySizes: [(String, Int)] = [
    ("iconTemplate", 18), ("iconTemplate@2x", 36),
]
for (name, px) in traySizes {
    let img = drawTrayGlyph(size: CGFloat(px))
    savePNG(img, size: px, to: "\(outDir)/\(name).png")
}

print("done")
