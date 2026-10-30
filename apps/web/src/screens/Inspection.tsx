import { useEffect, useState } from "react";
import { draft } from "../copy.ts";
import { useDeps } from "../deps.ts";
import type { InspectionRequest } from "../fixed-api.ts";
import { fixFor, ROUTES } from "../router.ts";
import { useLoad } from "../use-load.ts";
import { Failed, Problem } from "./Failed.tsx";

const Ready = ({ walkId, request }: { walkId: string; request: InspectionRequest }) => {
  const { phone } = useDeps();
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => setCopied(await phone.copy(`${request.subject}\n\n${request.body}`));
  return (
    <main className="screen inspection" data-ready="true">
      <h1>{draft.inspection.title}</h1>
      <p>{draft.inspection.intro}</p>
      <p data-part="subject">{draft.inspection.subject(request.subject)}</p>
      <p className="body" data-part="body">
        {request.body}
      </p>
      <button className="button primary" type="button" onClick={() => void copy()}>
        {draft.inspection.copy}
      </button>
      {copied === null ? null : <p role="status">{copied ? draft.inspection.copied : draft.inspection.copyFailed}</p>}
      {request.links.length === 0 ? null : (
        <section className="links">
          <h2>{draft.inspection.links}</h2>
          <ul className="lines">
            {request.links.map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <a className="button" href={fixFor(walkId)}>
        {draft.fixed.backToFix}
      </a>
    </main>
  );
};

export const Inspection = ({ inspectionId }: { inspectionId: string | null }) => {
  const deps = useDeps();
  const { loaded, retry } = useLoad(
    () => (inspectionId === null ? Promise.resolve({ code: "not_found" as const, message: "" }) : deps.fixed.inspection(inspectionId)),
    inspectionId ?? "",
  );

  useEffect(() => {
    if (inspectionId === null) window.location.replace(ROUTES.home);
  }, [inspectionId]);

  if (inspectionId === null) return null;
  if (loaded.state === "ready") return <Ready walkId={inspectionId} request={loaded.value} />;
  const failed = loaded.state === "failed" ? loaded.code : null;
  return (
    <main className="screen inspection" data-ready="false">
      <h1>{failed === "not_ready" ? draft.inspection.notReady : draft.inspection.title}</h1>
      {loaded.state === "loading" ? <p>{draft.inspection.writing}</p> : null}
      {failed === "not_ready" ? <Problem code={failed} /> : null}
      {failed === "conflict" ? <p className="problem" role="status">{draft.inspection.noRequired}</p> : null}
      {failed !== null && failed !== "not_ready" && failed !== "conflict" ? <Failed code={failed} retry={retry} /> : null}
      <a className="button" href={fixFor(inspectionId)}>
        {draft.fixed.backToFix}
      </a>
    </main>
  );
};
