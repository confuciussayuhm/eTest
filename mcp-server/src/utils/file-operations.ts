import fs from 'node:fs';
import path from 'node:path';

export function saveDeliverableFile(targetDir: string, filename: string, content: string): string {
  const deliverableDir = path.join(targetDir, 'deliverables');
  fs.mkdirSync(deliverableDir, { recursive: true });
  const filepath = path.join(deliverableDir, filename);
  fs.writeFileSync(filepath, content, 'utf-8');
  return filepath;
}
