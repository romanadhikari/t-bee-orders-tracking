import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tbeeAuthRouter from "./tbeeAuth";
import tbeeOrdersRouter from "./tbeeOrders";
import tbeeStorageRouter from "./tbeeStorage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tbeeAuthRouter);
router.use(tbeeOrdersRouter);
router.use(tbeeStorageRouter);

export default router;
