// Tes jalan lewat strip-types Node, yang menuntut ekstensi; kode src memakai impor tanpa ekstensi (gaya wrangler).
import { register } from "node:module";
register(new URL("./resolve-ts.mjs", import.meta.url));
