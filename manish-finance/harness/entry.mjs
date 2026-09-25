import SITE_ASSETS from "virtual:site-assets";
import { createApp } from "./host-worker.mjs";

export default createApp(SITE_ASSETS, [], {});
