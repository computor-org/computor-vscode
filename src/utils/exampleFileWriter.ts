import * as fs from 'fs';
import * as path from 'path';

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.pdf', '.zip', '.gz', '.tar', '.rar', '.7z', '.webp'
]);

function writeFileContent(filePath: string, content: string | Buffer): void {
  const ext = path.extname(filePath).toLowerCase();

  if (typeof content === 'string' && content.startsWith('data:') && content.includes(';base64,')) {
    const base64 = content.split(';base64,')[1] || '';
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  } else if (BINARY_EXTENSIONS.has(ext) && typeof content === 'string') {
    const cleaned = content.replace(/\s+/g, '');
    const isProbablyBase64 = /^[A-Za-z0-9+/=]+$/.test(cleaned) && cleaned.length % 4 === 0;
    if (isProbablyBase64) {
      fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
    } else {
      fs.writeFileSync(filePath, content);
    }
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

export function writeExampleFiles(
  files: Record<string, string | Buffer>,
  targetDir: string
): void {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(targetDir, filename);
    const fileDir = path.dirname(filePath);

    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }

    try {
      writeFileContent(filePath, content);
    } catch {
      fs.writeFileSync(filePath, content, 'utf8');
    }
  }
}
