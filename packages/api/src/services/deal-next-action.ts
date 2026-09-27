import type { OpportunityStage } from "@omnitwin/types";

/** What is owed on a deal when it arrives at a stage and nobody has said
 *  otherwise. One wording, whether a booker moved it or a proposal did. */
export function nextActionForStage(stage: OpportunityStage): string {
  switch (stage) {
    case "new":
      return "Qualify the enquiry and confirm the client, date, room, and rough guest count.";
    case "qualified":
      return "Prepare a proposal draft with planning-grade assumptions for review.";
    case "proposal_drafting":
      return "Save a proposal version and prepare the client share link.";
    case "proposal_sent":
      return "Wait for the client response and log any requested changes.";
    case "negotiation":
      return "Resolve quote or package changes before confirming the opportunity.";
    case "won":
      return "Prepare the handoff path after proposal acceptance.";
    case "lost":
      return "Record the reason and archive when follow-up is complete.";
    case "archived":
      return "No next action.";
  }
}
