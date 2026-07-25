// One definition of the post-round ladder: critic → attribution → rendition →
// standings, with the AI steps present only when the room asked for them.
//
// Local play, online play and the spectator balcony each used to own a private
// copy of this — the step type, the "does this round have an AI exhibition"
// test, the reset effect, the screen-identity fragment — and they had already
// drifted from one another.

import { useEffect, useRef, useState } from "react";
import { aiEnabled } from "../../shared/engine";
import type { Outcome, Settings } from "../../shared/types";

export type RevealStep = "critic" | "attribution" | "rendition" | "standings";

export interface RevealSequence {
  step: RevealStep;
  setStep: (step: RevealStep) => void;
  /** Does this round have AI screens at all? (Voided rounds never do.) */
  aiExhibition: boolean;
  /** Advance from the critic, remembering whether it was still thinking. */
  leaveCritic: (pending: boolean) => void;
  /** Advance from the attribution to whatever comes next. */
  leaveAttribution: () => void;
  /** Advance from the rendition, remembering whether it was still rendering. */
  leaveRendition: (pending: boolean) => void;
  /** Results that arrived after the player moved past them. */
  skipped: { critic: boolean; rendition: boolean };
}

export function useRevealSequence(params: {
  outcome: Outcome | null | undefined;
  roundNo: number | undefined;
  settings: Pick<Settings, "aiCritic" | "aiDetective"> | undefined;
}): RevealSequence {
  const aiExhibition =
    params.outcome !== "voided" && !!params.settings && aiEnabled(params.settings);
  const [step, setStep] = useState<RevealStep>(aiExhibition ? "critic" : "attribution");
  const skippedCritic = useRef(false);
  const skippedRendition = useRef(false);

  useEffect(() => {
    skippedCritic.current = false;
    skippedRendition.current = false;
    setStep(aiExhibition ? "critic" : "attribution");
  }, [params.roundNo, params.outcome, aiExhibition]);

  return {
    // A voided round is decided one broadcast before the effect can correct
    // the stored step, so derive rather than trust it.
    step: step === "critic" && !aiExhibition ? "attribution" : step,
    setStep,
    aiExhibition,
    leaveCritic: (pending) => {
      if (pending) skippedCritic.current = true;
      setStep("attribution");
    },
    leaveAttribution: () => setStep(aiExhibition ? "rendition" : "standings"),
    leaveRendition: (pending) => {
      if (pending) skippedRendition.current = true;
      setStep("standings");
    },
    skipped: { critic: skippedCritic.current, rendition: skippedRendition.current },
  };
}
