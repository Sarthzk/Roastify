import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import roastRoute from "./routes/roast.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", roastRoute);
app.listen(3001, () => console.log("Backend running on port 3001"));