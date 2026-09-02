import { Check, Sparkles, Zap, BookOpen, Briefcase, Smile } from "lucide-react";
import { useEffect, useState } from "react";
import {
  readResponseStyle,
  setResponseStyle,
  STYLE_LABELS_AR,
  type ResponseStyle,
} from "@/lib/responseStyle";
import {
  readChatModelPreferences,
  setChatModelPreferences,
  type ChatModelPreferences,
} from "@/lib/chatModelPreferences";

const OPTIONS: Array<{ id: ResponseStyle; icon: typeof Sparkles; description: string }> = [
  { id: "auto", icon: Sparkles, description: "Adapts the answer to your request" },
  { id: "concise", icon: Zap, description: "Short, direct answers" },
  { id: "detailed", icon: BookOpen, description: "Thorough answers with examples" },
  { id: "formal", icon: Briefcase, description: "Professional, structured tone" },
  { id: "friendly", icon: Smile, description: "Warm, conversational tone" },
];

export function ChatModelSettingsPanel() {
  const [current, setCurrent] = useState<ResponseStyle>("auto");
  const [preferences, setPreferences] = useState<ChatModelPreferences>(() => readChatModelPreferences());
  useEffect(() => {
    setCurrent(readResponseStyle());
    setPreferences(readChatModelPreferences());
  }, []);
  const updatePreferences = (next: ChatModelPreferences) => {
    setPreferences(next);
    setChatModelPreferences(next);
  };

  return (
    <div className="space-y-3">
      {/* Deep thinking — same toggle as the mobile settings panel */}
      <div className="overflow-hidden rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03]">
        <button
          type="button"
          aria-pressed={preferences.deepThinking}
          onClick={() => updatePreferences({ ...preferences, deepThinking: !preferences.deepThinking })}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-start transition-colors hover:bg-foreground/[0.03]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-foreground">Deep thinking</span>
            <span className="mt-0.5 block text-[12px] text-foreground/50">Plan step-by-step before answering</span>
          </span>
          <span
            aria-hidden="true"
            className="theme-fixed relative h-[31px] w-[51px] shrink-0 rounded-full bg-white transition-colors duration-300 ease-out"
          >
            <span
              className="theme-fixed absolute top-1/2 left-0 h-[27px] w-[27px] rounded-full bg-white transition-transform duration-300 ease-out"
              style={{
                transform: `translate(${preferences.deepThinking ? "22px" : "2px"}, -50%)`,
                boxShadow: "0 3px 8px rgba(0,0,0,0.15), 0 3px 1px rgba(0,0,0,0.06)",
              }}
            />
          </span>
        </button>
      </div>

      <div className="flex flex-col rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03] overflow-hidden">
        {OPTIONS.map(({ id, icon: Icon, description }) => {
          const active = current === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => { setResponseStyle(id); setCurrent(id); }}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-start transition-colors border-b border-foreground/[0.06] last:border-b-0 ${active ? "bg-foreground/[0.04]" : "hover:bg-foreground/[0.03]"}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.06]"><Icon className="h-4 w-4 text-foreground/80" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-foreground">{STYLE_LABELS_AR[id]}</span>
                <span className="block truncate text-[12px] text-foreground/55">{description}</span>
              </span>
              {active ? <Check className="h-5 w-5 shrink-0" strokeWidth={2.75} style={{ color: "var(--megsy-blue)" }} /> : null}
            </button>
          );
        })}
      </div>
      <p className="px-4 text-[12px] text-foreground/50 leading-relaxed">Applied to chat and service responses.</p>
    </div>
  );
}