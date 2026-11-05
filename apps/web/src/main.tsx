import { boot } from "./boot.tsx";
import { appDeps } from "./deps.ts";
import "./styles.css";

boot(document, navigator.serviceWorker, import.meta.env.PROD, appDeps());
