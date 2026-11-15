import { register } from "node:module";

register(new URL("./test-loader.mjs", import.meta.url));
