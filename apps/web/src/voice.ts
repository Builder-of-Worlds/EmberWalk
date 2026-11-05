import voiceClips from "./voice-clips.json";

export type Spoke = "clip" | "phone" | "none";

export type Voice = { say(text: string): Promise<Spoke>; stop(): void };

export type VoiceEnv = {
  newAudio: (src: string) => { play(): Promise<void>; pause(): void };
  speech: { speak(text: string, lang: string): void; cancel(): void } | null;
  language: () => string;
};

export const sentenceKey = (sentence: string): string => sentence.trim();

export const clipUrlFor = (sentence: string, clips: Record<string, string>): string | null => clips[sentenceKey(sentence)] ?? null;

export const browserVoice = (env: VoiceEnv, clips: Record<string, string> = voiceClips): Voice => {
  let playing: ReturnType<VoiceEnv["newAudio"]> | null = null;
  const stop = () => {
    playing?.pause();
    playing = null;
    env.speech?.cancel();
  };
  return {
    stop,
    say: async (text) => {
      stop();
      const url = clipUrlFor(text, clips);
      if (url !== null) {
        const audio = env.newAudio(url);
        try {
          await audio.play();
          playing = audio;
          return "clip";
        } catch {
          playing = null;
        }
      }
      if (env.speech === null) return "none";
      env.speech.speak(text, env.language());
      return "phone";
    },
  };
};

export const browserVoiceEnv = (w: Window & typeof globalThis): VoiceEnv => ({
  newAudio: (src) => new w.Audio(src),
  speech:
    w.speechSynthesis === undefined
      ? null
      : {
          speak: (text, lang) => {
            const utterance = new w.SpeechSynthesisUtterance(text);
            utterance.lang = lang;
            w.speechSynthesis.speak(utterance);
          },
          cancel: () => w.speechSynthesis.cancel(),
        },
  language: () => w.document.documentElement.lang || "en",
});
