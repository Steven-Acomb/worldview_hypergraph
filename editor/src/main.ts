import "./styles.css";
import { App } from "./app.js";

const root = document.getElementById("app");
if (!root) throw new Error("#app not found");
const app = new App(root);
void app.start();
