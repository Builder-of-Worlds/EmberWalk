import { movedWords, signInAgainNoted } from "../draft-words.ts";
import { ROUTES } from "../router.ts";

export const SignInAgain = () =>
  signInAgainNoted() ? (
    <>
      <p role="status">{movedWords.signInAgain}</p>
      <a className="button" href={ROUTES.signIn}>
        {movedWords.signIn}
      </a>
    </>
  ) : null;
