import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiChatRouter from "./ai-chat";
import searchRouter from "./search";
import execRouter from "./exec";
import proxyRouter from "./proxy";
import voiceRouter from "./voice";
import githubRouter from "./github";
import configRouter from "./config";
import driveRouter from "./drive";
import uploadRouter from "./upload";
import legalAiRouter from "./legal-ai";
import workspaceRouter from "./workspace";
import dbRouter from "./db";
import aiForwardRouter from "./ai-forward";
import twaRouter from "./twa";

const router: IRouter = Router();

router.use(configRouter);
router.use(healthRouter);
router.use(twaRouter);
router.use(aiChatRouter);
router.use(legalAiRouter);
router.use(searchRouter);
router.use(execRouter);
router.use(proxyRouter);
router.use("/voice", voiceRouter);
router.use(githubRouter);
router.use(driveRouter);
router.use(uploadRouter);
router.use(workspaceRouter);
router.use(dbRouter);
router.use(aiForwardRouter);

export default router;
