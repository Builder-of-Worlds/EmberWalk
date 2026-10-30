import { useEffect, useState } from "react";
import { copy } from "../copy.ts";
import { useLoadedStill } from "../live-results.ts";
import type { SecondCheck } from "../results.ts";

const PreviewImage = ({ preview, onFail }: { preview: string; onFail: () => void }) => {
  const { shown, failed } = useLoadedStill(preview);
  useEffect(() => {
    if (failed) onFail();
  }, [failed, onFail]);
  return (
    <figure className="fix-preview" id="fix-preview">
      {shown === null ? null : <img src={shown} alt="" />}
      <figcaption className="ai-label">{copy.finding.aiPreview}</figcaption>
    </figure>
  );
};

export const FixPreview = ({ preview }: { preview: string }) => {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <>
      <button className="button" type="button" aria-expanded={open} aria-controls="fix-preview" onClick={() => setOpen(!open)}>
        {copy.finding.seeFixed}
      </button>
      {open ? <PreviewImage preview={preview} onFail={() => setFailed(true)} /> : null}
    </>
  );
};

export const SecondCheckNote = ({ check }: { check: SecondCheck | null | undefined }) =>
  check?.verdict === "flags" ? (
    <p className="second-check" role="note">
      {copy.finding.secondCheck(check.reason)}
    </p>
  ) : null;
