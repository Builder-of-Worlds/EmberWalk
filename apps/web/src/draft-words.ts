export const DRAFT_WORDS_KEY = "emberwalk.draftWords";

export const draftWordsShown = (storage: () => Pick<Storage, "getItem"> = () => window.localStorage): boolean => {
  try {
    return storage().getItem(DRAFT_WORDS_KEY) === "on";
  } catch {
    return false;
  }
};
