// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0

// publish · RENDER COVER — render a marketing-video title cover PNG via CoreText
// (macOS-native; no ffmpeg drawtext / PIL / ImageMagick dependency).
//
// usage: swift render-cover.swift <width> <height> <outPath> <nameFile> <descFile> [iconPath]
//   name/description are read from files to avoid shell-escaping arbitrary text.

import Foundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard a.count >= 6, let W = Int(a[1]), let H = Int(a[2]) else {
    FileHandle.standardError.write("usage: render-cover <w> <h> <out> <nameFile> <descFile> [icon]\n".data(using: .utf8)!)
    exit(2)
}
let outPath = a[3]
let name = ((try? String(contentsOfFile: a[4], encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
let desc = ((try? String(contentsOfFile: a[5], encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
let iconPath = a.count >= 7 ? a[6] : ""

let Wf = CGFloat(W), Hf = CGFloat(H)
let cs = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                          space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(3) }

// Background.
ctx.setFillColor(CGColor(red: 0x0E/255.0, green: 0x11/255.0, blue: 0x16/255.0, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: Wf, height: Hf))

let margin = Wf * 0.09
let textW = Wf - 2 * margin

func centeredPara() -> CTParagraphStyle {
    var alignment = CTTextAlignment.center
    // CTParagraphStyleCreate copies the setting values, so a pointer valid only
    // for the duration of this call is sufficient.
    return withUnsafeBytes(of: &alignment) { raw in
        let setting = CTParagraphStyleSetting(spec: .alignment,
                                              valueSize: MemoryLayout<CTTextAlignment>.size,
                                              value: raw.baseAddress!)
        return CTParagraphStyleCreate([setting], 1)
    }
}

func makeFrame(_ s: String, size: CGFloat, bold: Bool, color: CGColor) -> (CTFrame, CGFloat) {
    let font = CTFontCreateWithName((bold ? "Helvetica-Bold" : "Helvetica") as CFString, size, nil)
    let attrs: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
        NSAttributedString.Key(kCTParagraphStyleAttributeName as String): centeredPara(),
    ]
    let astr = NSAttributedString(string: s, attributes: attrs)
    let fs = CTFramesetterCreateWithAttributedString(astr)
    let constraint = CGSize(width: textW, height: .greatestFiniteMagnitude)
    let sz = CTFramesetterSuggestFrameSizeWithConstraints(fs, CFRangeMake(0, 0), nil, constraint, nil)
    let h = ceil(sz.height) + size * 0.3
    let path = CGPath(rect: CGRect(x: 0, y: 0, width: textW, height: h), transform: nil)
    return (CTFramesetterCreateFrame(fs, CFRangeMake(0, 0), path, nil), h)
}

let nameSize = max(28, Wf * 0.075)
let descSize = max(18, Wf * 0.040)
let (nameFrame, nameH) = makeFrame(name.isEmpty ? " " : name, size: nameSize, bold: true,
                                   color: CGColor(gray: 1, alpha: 1))
let hasDesc = !desc.isEmpty
var descFrame: CTFrame? = nil
var descH: CGFloat = 0
if hasDesc {
    let (f, h) = makeFrame(desc, size: descSize, bold: false,
                           color: CGColor(red: 0xC9/255.0, green: 0xCD/255.0, blue: 0xD6/255.0, alpha: 1))
    descFrame = f; descH = h
}

let gap = hasDesc ? descSize * 1.0 : 0
let iconSize: CGFloat = iconPath.isEmpty ? 0 : Wf * 0.24
let iconGap: CGFloat = iconPath.isEmpty ? 0 : Hf * 0.03
let block = iconSize + iconGap + nameH + gap + descH
var topY = max(Hf * 0.12, (Hf - block) / 2)   // top-down y

if !iconPath.isEmpty,
   let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: iconPath) as CFURL, nil),
   let img = CGImageSourceCreateImageAtIndex(src, 0, nil) {
    let ix = (Wf - iconSize) / 2
    let iy = Hf - topY - iconSize                // top-down → bottom-up
    ctx.draw(img, in: CGRect(x: ix, y: iy, width: iconSize, height: iconSize))
    topY += iconSize + iconGap
}

func drawFrame(_ frame: CTFrame, topDownY: CGFloat, height: CGFloat) {
    ctx.saveGState()
    ctx.translateBy(x: margin, y: Hf - topDownY - height)
    CTFrameDraw(frame, ctx)
    ctx.restoreGState()
}

drawFrame(nameFrame, topDownY: topY, height: nameH)
topY += nameH + gap
if let df = descFrame { drawFrame(df, topDownY: topY, height: descH) }

guard let outImg = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL,
                                                 UTType.png.identifier as CFString, 1, nil) else { exit(4) }
CGImageDestinationAddImage(dest, outImg, nil)
guard CGImageDestinationFinalize(dest) else { exit(5) }
print("cover \(W)x\(H) -> \(outPath)")
