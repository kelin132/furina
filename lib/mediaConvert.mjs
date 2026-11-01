import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

async function convert(inputBuffer, inputExtension, outputExtension, argsForPaths) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new Error("No media data was downloaded.");
  }
  if (inputBuffer.length > MAX_INPUT_BYTES) {
    throw new Error("The replied media is too large (maximum 64 MB).");
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "furina-media-"));
  const inputPath = path.join(directory, `input.${inputExtension}`);
  const outputPath = path.join(directory, `output.${outputExtension}`);
  try {
    await fs.writeFile(inputPath, inputBuffer);
    await execFileAsync(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        ...argsForPaths(inputPath, outputPath),
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true },
    );

    const output = await fs.readFile(outputPath);
    if (!output.length) throw new Error("The converter produced an empty file.");
    if (output.length > MAX_OUTPUT_BYTES) {
      throw new Error("The converted media is too large to send (maximum 32 MB).");
    }
    return output;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("FFmpeg is not installed on the bot host.");
    }
    if (error.killed || error.signal === "SIGTERM") {
      throw new Error("Media conversion timed out. Try a shorter clip.");
    }
    throw new Error("FFmpeg could not process this media file.");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export function videoToMp3(buffer) {
  return convert(buffer, "video", "mp3", (input, output) => [
    "-i", input,
    "-t", "120",
    "-vn",
    "-codec:a", "libmp3lame",
    "-b:a", "128k",
    "-f", "mp3",
    output,
  ]);
}

export async function animatedWebpToMp4(buffer) {
  let gif;
  try {
    // FFmpeg builds used by common bot hosts often decode only still WebP.
    // Sharp expands animated WebP into a GIF frame sequence before encoding.
    gif = await sharp(buffer, { animated: true }).gif({ loop: 0 }).toBuffer();
  } catch {
    throw new Error("Could not decode the animated sticker.");
  }

  return convert(gif, "gif", "mp4", (input, output) => [
    "-i", input,
    "-an",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-f", "mp4",
    output,
  ]);
}
