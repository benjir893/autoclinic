require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieparser = require("cookie-parser");
const dns = require("dns");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

//use public dns server for mongodb server lookup
if (process.env.NODE_ENV != "production") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://autoclinic-9168b.web.app",
  "https://autoclinic-9168b.firebaseapp.com",
];

if (process.env.CLIENT_URL && !allowedOrigins.includes(process.env.CLIENT_URL)) {
  allowedOrigins.push(process.env.CLIENT_URL);
}

// Middlewares
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieparser());

//user
const db_user = encodeURIComponent(process.env.DB_USER);
const db_password = encodeURIComponent(process.env.DB_PASS);

//access token
const secret = process.env.ACCESS_TOKEN_SECRET;
if (!secret) {
  throw new Error("There is no ACCESS_TOKEN_SECRET created");
}
const verifyToken = (req, res, next) => {
  const token = req.cookies?.accessToken;
  if (!token) {
    return res.status(401).send({ success: false, message: "token not found" });
  }
  jwt.verify(token, secret, (error, decoded) => {
    if (error) {
      return res
        .status(401)
        .send({ success: false, message: "this token not allowed" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${db_user}:${db_password}@cluster0.mym2gsq.mongodb.net/?appName=Cluster0`;

// cookie configuration
const isProduction = process.env.NODE_ENV === "production";
const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  partitioned: isProduction,
  path: "/",
};
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Keep one cached connection promise for local Node and Vercel serverless.
const mongoConnection = client.connect();

// Define collection handles synchronously so every route exists immediately.
const database = client.db("autoclinic");
const autousers = database.collection("users");
const autoservices = database.collection("carservices");
const servicebooked = database.collection("servicebooking");
const autoparts = database.collection("carparts");
const autopartsorder = database.collection("partsordered");
const employees = database.collection("techteam");
const feedback = database.collection("feedback");

app.get("/", (req, res) => {
  res.send("2nd auto server is running");
});

// Wait for MongoDB before running an API route instead of registering routes late.
app.use(async (req, res, next) => {
  try {
    await mongoConnection;
    next();
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    res.status(500).send({
      success: false,
      message: "Database connection failed",
    });
  }
});

    //jwt api
    app.post("/jwt", (req, res) => {
      try {
        const email = req.body.email?.trim().toLowerCase();
        if (!email) {
          return res
            .status(400)
            .send({ success: false, message: "email required" });
        }
        const token = jwt.sign({ email }, secret, { expiresIn: "2h" });
        res
          .cookie("accessToken", token, {
            ...cookieOptions,
            maxAge: 60 * 120 * 1000,
          })
          .status(200)
          .send({ success: true, message: "token stored in cookie" });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Token is not created" });
      }
    });

    //service api
    app.get("/user", async (req, res) => {
      try {
        const email = req.query.email?.trim().toLowerCase();
        if (!email) {
          return res
            .status(400)
            .send({ success: false, message: "email not found" });
        }
        const user = await autousers.findOne({ email });
        if (!user) {
          return res
            .status(404)
            .send({ success: false, message: "user not found" });
        }
        res.send(user);
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: "Could not load user" });
      }
    });

    app.post("/user", async (req, res) => {
      const query = req.body;
      const result = await autousers.insertOne(query);
      res.send(result);
    });
    app.get("/service", async (req, res) => {
      const result = await autoservices.find().toArray();
      res.send(result);
    });

    app.get("/service/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await autoservices.findOne(query);
      res.send(result);
    });
    // ......................................................

    app.post("/servicebooking", verifyToken, async (req, res) => {
      const booking = req.body;
      const bookingEmail = booking.email?.trim().toLowerCase();
      if (!bookingEmail) {
        return res
          .status(400)
          .send({ success: false, message: "booking email required" });
      }
      if (req.decoded.email !== bookingEmail) {
        return res
          .status(403)
          .send({ success: false, message: "forbidden access" });
      }
      const result = await servicebooked.insertOne({
        ...booking,
        email: bookingEmail,
        status: "pending",
      });
      res.send(result);
    });
    // ..............................................................

    app.get("/servicebooking", verifyToken, async (req, res) => {
      const email = req.decoded.email;

      const result = await servicebooked.find({ email }).toArray();
      res.send(result);
    });
    // ==============================================

    app.patch("/servicebooking/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .send({ success: false, message: "ObjectId is not valid" });
        }
        const email = req.decoded.email;
        const query = { _id: new ObjectId(id), email, status: "pending" };
        const update = { $set: { status: "confirmed" } };
        const result = await servicebooked.updateOne(query, update);
        if (result.matchedCount === 0) {
          return res
            .status(404)
            .send({ success: false, message: "booking not found" });
        }
        res.send({
          success: true,
          message: "booking updated",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          success: false,
          message: "booking have not updated",
        });
      }
    });
    // ==========================================

    app.delete("/servicebooking/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            success: false,
            message: "Invalid id",
          });
        }
        const email = req.decoded.email;
        const query = { _id: new ObjectId(id), email };
        const result = await servicebooked.deleteOne(query);
        if (result.deletedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "booking not found",
          });
        }
        // res.send(result);
        res.send({
          success: true,
          message: "booking deleted",
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: "bad request" });
      }
    });
    // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

    app.get("/carpart", async (req, res) => {
      const result = await autoparts.find().toArray();
      res.send(result);
    });
    app.get("/carpart/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .send({ success: false, message: "Object id not found" });
        }
        const query = { _id: new ObjectId(id) };
        const result = await autoparts.findOne(query);
        res.send(result);
      } catch (error) {
        console.error(error);
      }
    });

    app.post("/partorder", verifyToken, async (req, res) => {
      const carpart = req.body;
      const useremail = carpart.email?.trim().toLowerCase();
      if (!useremail) {
        return res
          .status(400)
          .send({ success: false, message: "user email is required" });
      }
      if (req.decoded.email !== useremail) {
        return res
          .status(401)
          .send({ success: false, message: "user email is not valid" });
      }
      const result = await autopartsorder.insertOne({
        ...carpart,
        email: useremail,
        status: "pending",
      });
      res.send(result);
    });
    // --------------------------------------------------------------
    app.get("/partorder", verifyToken, async (req, res) => {
      const email = req.decoded.email;
      const result = await autopartsorder.find({ email }).toArray();
      res.send(result);
    });

    //--------------------------------------------------------------
    app.patch("/partorder/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res
            .status(404)
            .send({ success: false, message: "Object id is not valid" });
        }
        const email = req.decoded.email;
        const query = { _id: new ObjectId(id), email, status: "pending" };
        const update = { $set: { status: "confirmed" } };
        const result = await autopartsorder.updateOne(query, update);
        if (result.matchedCount === 0) {
          return res
            .status(404)
            .send({ success: false, message: "order not found" });
        }
        res.status(200).send({
          success: true,
          message: "status updated",
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: "order not found" });
      }
    });
    // -------------------------------------------------------------
    app.delete("/partorder/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .send({ success: false, message: "Object id is not valid" });
        }
        const email = req.decoded.email;
        const query = { _id: new ObjectId(id), email };
        const result = await autopartsorder.deleteOne(query);
        if (result.deletedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "order not deleted",
          });
        }
        res.status(200).send({
          success: true,
          message: "order deleted successfully",
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          success: false,
          message: "could not delete order",
        });
      }
    });
    // ....................................................................
    app.get("/employee", async (req, res) => {
      const result = await employees.find().toArray();
      res.send(result);
    });
    // ....................................................................
    app.post("/feedback", verifyToken, async (req, res) => {
      const csfeedback = req.body;
      const useremail = csfeedback.email?.trim().toLowerCase();
      if (!useremail) {
        return res
          .status(400)
          .send({ success: false, message: "email required" });
      }
      if (req.decoded.email !== useremail) {
        return res
          .status(401)
          .send({ success: false, message: "email is not valid" });
      }
      const result = await feedback.insertOne(csfeedback);
      res.send(result);
    });
    // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
    app.get("/feedback", async (req, res) => {
      const result = await feedback.find().toArray();
      res.send(result);
    });
    // ....................................................
    app.post("/logout", (req, res) => {
      res
        .clearCookie("accessToken", cookieOptions)
        .status(200)
        .send({ success: true, message: "Logged out successfully" });
    });
// for locally run
if (require.main === module) {
  app.listen(port, () => {
    console.log(`auto server is running on ${port}`);
    console.log("Mongo db is connected successfully");
  });
}
// export for vercel
module.exports = app;
