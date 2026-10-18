// The chat answer's last line is "@@bubble: <text>" (the bubble over the character). The chat route cuts it out of
// the stream before anything reaches the client: text that could still turn into the marker (a trailing "@", "@@b",
// "**@@bu", the blank line before it) is held back until the next chunk settles it, so the marker never flashes in
// the chat, even mid-stream. After the answer the route sends BUBBLE_SEP, then the bubble; the client splits on that
// one character, which can't be broken across chunks. Pure, so scripts/check.mjs drives it chunk by chunk.

export const BUBBLE_SEP = '\u001e';
const MARK = '@@bubble:';

export class BubbleSplitter {
  private held = '';
  private bubble: string | null = null;

  /** Text that is safe to show now. */
  push(chunk: string): string {
    if (this.bubble !== null) {
      this.bubble += chunk;
      return '';
    }
    const buf = this.held + chunk;
    const at = buf.toLowerCase().indexOf(MARK);
    if (at >= 0) {
      this.bubble = buf.slice(at + MARK.length);
      this.held = '';
      return buf.slice(0, at).replace(/[\s*_]+$/, '');
    }
    // Hold back the longest tail that could start the marker, and the whitespace or bold markers before it.
    const low = buf.toLowerCase();
    let keep = 0;
    for (let k = Math.min(MARK.length - 1, low.length); k > 0; k--)
      if (MARK.startsWith(low.slice(-k))) {
        keep = k;
        break;
      }
    let cut = buf.length - keep;
    while (cut > 0 && /[\s*_]/.test(buf[cut - 1])) cut--;
    this.held = buf.slice(cut);
    return buf.slice(0, cut);
  }

  /** The end of the stream: whatever was held that turned out not to be the marker, and the bubble's raw text. */
  end(): { rest: string; bubble: string } {
    const rest = this.bubble === null ? this.held.replace(/\s+$/, '') : '';
    this.held = '';
    return { rest, bubble: (this.bubble ?? '').trim() };
  }
}
