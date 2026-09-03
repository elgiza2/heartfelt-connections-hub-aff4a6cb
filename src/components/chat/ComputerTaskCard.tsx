/**
 * @doc Silent in-chat surface for a Computer Agent task.
 *
 * Deliberately chrome-less: while the computer works it is a single quiet
 * progress line — no labels, no icons, no buttons. The narration lives in the
 * thinking trace above it, so this surface only carries what the task actually
 * produced (text + files) once it is finished.
 */
import { useEffect, useRef, useState } from "react";
import {
  pollComputerTask,
  type ComputerTask,
} from "@/lib/computer/client";

interface Props {
  taskId: string;
}

const POLL_MS = 3000;

export default function ComputerTaskCard({ taskId }: Props) {
  const [task, setTask] = useState<ComputerTask | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await pollComputerTask(taskId);
        if (cancelled) return;
        setTask(res.task);
        const finished = res.task.status === "done" || res.task.status === "failed";
        if (!finished) timer.current = setTimeout(tick, POLL_MS);
      } catch {
        if (!cancelled) timer.current = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [taskId]);

  const running = !task || task.status === "pending" || task.status === "running";
  const files = task?.files ?? [];

  // Running: one hairline shimmer, nothing else.
  if (running) {
    return (
      <div className="my-2 h-[3px] w-full max-w-[320px] overflow-hidden rounded-full bg-foreground/[0.07]">
        <div className="h-full w-1/3 rounded-full bg-foreground/25 motion-safe:animate-[computer-scan_1.5s_ease-in-out_infinite]" />
      </div>
    );
  }

  if (!task?.result_text && files.length === 0) return null;

  return (
    <div className="my-1">
      {task?.result_text && (
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/90">
          {task.result_text}
        </p>
      )}

      {files.length > 0 && (
        <div className="mt-2 space-y-2">
          {files.map((f) => {
            const isImage = /\.(png|jpe?g|webp|gif|avif)$/i.test(f.url) || f.type?.startsWith("image/");
            const isVideo = /\.(mp4|webm|mov)$/i.test(f.url) || f.type?.startsWith("video/");
            return (
              <div key={f.url} className="overflow-hidden rounded-xl border border-border/40">
                {isImage ? (
                  <img src={f.url} alt={f.name} loading="lazy" className="max-h-64 w-full object-cover" />
                ) : isVideo ? (
                  <video src={f.url} controls className="max-h-64 w-full" />
                ) : (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate px-3 py-2 text-[12.5px] text-foreground/85 hover:bg-foreground/5"
                  >
                    {f.name}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
