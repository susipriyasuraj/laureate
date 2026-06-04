import express from "express";
import {
  getInboxController,
  getCaseStatusController,
  triggerScreeningController,
  submitHumanDecisionController,
  resetJobsController,
} from "../controllers/uiCompatController.js";

const router = express.Router();

router.get("/inbox", getInboxController);
router.get("/case-status/:studentId", getCaseStatusController);
router.post("/trigger-screening/:studentId", triggerScreeningController);
router.post("/human-decision/:threadId", submitHumanDecisionController);
router.post("/reset", resetJobsController);

export default router;
