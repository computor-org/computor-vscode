import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { contentIconSvg, ContentIconBadge, ContentIconCorner, ContentIconShape } from './contentIconSvg';

export class IconGenerator {
  private static iconCache: Map<string, vscode.Uri> = new Map();
  private static iconDir: string;

  static initialize(context: vscode.ExtensionContext): void {
    this.iconDir = path.join(context.globalStorageUri.fsPath, 'icons');
    
    // Ensure icon directory exists
    if (!fs.existsSync(this.iconDir)) {
      fs.mkdirSync(this.iconDir, { recursive: true });
    }
  }

  static getColoredIcon(color: string, shape: 'circle' | 'square' = 'circle'): vscode.Uri | vscode.ThemeIcon {
    // Normalize color
    const normalizedColor = this.normalizeColor(color);
    if (!normalizedColor) {
      return new vscode.ThemeIcon('symbol-enum');
    }

    // Check if icon directory is initialized
    if (!this.iconDir) {
      console.warn('[IconGenerator] Icon directory not initialized, using fallback icon');
      return new vscode.ThemeIcon('symbol-enum');
    }

    const cacheKey = `${shape}-${normalizedColor}`;

    // Check cache
    if (this.iconCache.has(cacheKey)) {
      return this.iconCache.get(cacheKey)!;
    }

    // Generate SVG
    const svg = this.generateSvg(normalizedColor, shape);
    const fileName = `${cacheKey}.svg`;
    const filePath = path.join(this.iconDir, fileName);

    // Ensure directory exists before writing
    if (!fs.existsSync(this.iconDir)) {
      fs.mkdirSync(this.iconDir, { recursive: true });
    }

    // Write SVG to file
    fs.writeFileSync(filePath, svg);

    // Create Uri and cache it
    const uri = vscode.Uri.file(filePath);
    this.iconCache.set(cacheKey, uri);

    return uri;
  }

  static getColoredIconWithBadge(
    color: string,
    shape: 'circle' | 'square' = 'circle',
    badge: 'success' | 'success-submitted' | 'failure' | 'failure-submitted' | 'submitted' | 'none' = 'none',
    corner: 'corrected' | 'correction_necessary' | 'correction_possible' | 'none' = 'none',
    unreviewed: boolean = false
  ): vscode.Uri | vscode.ThemeIcon {
    const normalizedColor = this.normalizeColor(color);
    if (!normalizedColor) {
      return new vscode.ThemeIcon('symbol-enum');
    }

    // Check if icon directory is initialized
    if (!this.iconDir) {
      console.warn('[IconGenerator] Icon directory not initialized, using fallback icon');
      return new vscode.ThemeIcon('symbol-enum');
    }

    const cacheKey = `${shape}-${normalizedColor}-${badge}-${corner}-${unreviewed ? 'unrev' : 'rev'}`;
    if (this.iconCache.has(cacheKey)) {
      return this.iconCache.get(cacheKey)!;
    }

    const svg = this.generateSvg(normalizedColor, shape, badge, corner, unreviewed);
    const fileName = `${cacheKey}.svg`;
    const filePath = path.join(this.iconDir, fileName);

    // Ensure directory exists before writing
    if (!fs.existsSync(this.iconDir)) {
      fs.mkdirSync(this.iconDir, { recursive: true });
    }

    fs.writeFileSync(filePath, svg);
    const uri = vscode.Uri.file(filePath);
    this.iconCache.set(cacheKey, uri);
    return uri;
  }

  private static generateSvg(
    color: string,
    shape: ContentIconShape,
    badge: ContentIconBadge = 'none',
    corner: ContentIconCorner = 'none',
    unreviewed: boolean = false
  ): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${contentIconSvg(color, shape, badge, corner, unreviewed)}`;
  }

  private static normalizeColor(color: string): string | null {
    if (!color) return null;

    // If it's already a hex color, validate it
    if (color.startsWith('#')) {
      const hex = color.match(/^#([0-9A-Fa-f]{3}){1,2}$/);
      return hex ? color : null;
    }

    // Convert common color names to hex
    const colorMap: { [key: string]: string } = {
      'red': '#FF0000',
      'green': '#00FF00',
      'blue': '#0000FF',
      'yellow': '#FFFF00',
      'orange': '#FFA500',
      'purple': '#800080',
      'pink': '#FFC0CB',
      'brown': '#A52A2A',
      'black': '#000000',
      'white': '#FFFFFF',
      'gray': '#808080',
      'grey': '#808080',
      'cyan': '#00FFFF',
      'magenta': '#FF00FF',
      'lime': '#00FF00',
      'indigo': '#4B0082',
      'violet': '#EE82EE',
      'turquoise': '#40E0D0',
      'gold': '#FFD700',
      'silver': '#C0C0C0',
      'navy': '#000080',
      'teal': '#008080',
      'maroon': '#800000',
      'olive': '#808000',
      'fuchsia': '#FF00FF'
    };

    const lowerColor = color.toLowerCase().trim();
    return colorMap[lowerColor] || null;
  }

  static cleanup(): void {
    // Clean up icon files on deactivation
    if (fs.existsSync(this.iconDir)) {
      const files = fs.readdirSync(this.iconDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(this.iconDir, file));
      });
    }
    this.iconCache.clear();
  }
}
