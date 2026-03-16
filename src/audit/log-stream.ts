/**
 * LogStream - Stream composition utility for append-only logging
 */

import fs from 'fs';
import path from 'path';
import { ensureDirectory } from '../utils/file-io.js';

export class LogStream {
  private readonly filePath: string;
  private stream: fs.WriteStream | null = null;
  private _isOpen: boolean = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async open(): Promise<void> {
    if (this._isOpen) return;
    await ensureDirectory(path.dirname(this.filePath));
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a', encoding: 'utf8', autoClose: true });
    this.stream.on('error', (err) => {
      console.error(`LogStream error for ${this.filePath}:`, err.message);
      this._isOpen = false;
    });
    this._isOpen = true;
  }

  async write(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._isOpen || !this.stream) { reject(new Error('LogStream not open')); return; }
      const stream = this.stream;
      let drainHandler: (() => void) | null = null;
      const cleanup = () => { if (drainHandler) { stream.removeListener('drain', drainHandler); drainHandler = null; } };
      const needsDrain = !stream.write(text, 'utf8', (error) => {
        cleanup();
        if (error) reject(error);
        else if (!needsDrain) resolve();
      });
      if (needsDrain) {
        drainHandler = () => { cleanup(); resolve(); };
        stream.once('drain', drainHandler);
      }
    });
  }

  async close(): Promise<void> {
    if (!this._isOpen || !this.stream) return;
    return new Promise((resolve) => {
      this.stream!.end(() => { this._isOpen = false; this.stream = null; resolve(); });
    });
  }

  get isOpen(): boolean { return this._isOpen; }
  get path(): string { return this.filePath; }
}
