// Wires game moments to sound/haptics/title changes. Pure edge-detection —
// each cue fires once per transition.

import { useEffect, useRef } from "react";
import type { Phase } from "../../shared/types";
import { cueCard, cueReveal, cueRound, cueYourTurn } from "./sound";

const BASE_TITLE = "The Uninvited Painter";

export function useGameCues(params: {
  phase: Phase | null;
  yourTurn: boolean;
  cardWaiting: boolean;
}): void {
  const prevPhase = useRef<Phase | null>(null);
  const prevTurn = useRef(false);
  const prevCard = useRef(false);

  useEffect(() => {
    if (params.phase !== prevPhase.current) {
      if (params.phase === "dealing") cueRound();
      if (params.phase === "reveal") cueReveal();
      prevPhase.current = params.phase;
    }
  }, [params.phase]);

  useEffect(() => {
    if (params.yourTurn && !prevTurn.current) {
      cueYourTurn();
      document.title = `● Your stroke — ${BASE_TITLE}`;
    } else if (!params.yourTurn && prevTurn.current) {
      document.title = BASE_TITLE;
    }
    prevTurn.current = params.yourTurn;
  }, [params.yourTurn]);

  useEffect(() => {
    if (params.cardWaiting && !prevCard.current) cueCard();
    prevCard.current = params.cardWaiting;
  }, [params.cardWaiting]);

  // Leaving the game restores the tab title.
  useEffect(() => {
    return () => {
      document.title = BASE_TITLE;
    };
  }, []);
}
