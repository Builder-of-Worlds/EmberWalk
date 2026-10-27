import { boot } from "./boot.tsx";
import { browserDeps } from "./deps.ts";
import "./styles.css";

boot(document, navigator.serviceWorker, import.meta.env.PROD, browserDeps());
