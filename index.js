require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-admin-key.json");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

//middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    console.log("decoded:", decoded);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const verifyTokenEmail = (req, res, next) => {
  if (req.query.email !== req.decoded.email) {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.uzfctdd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const courseCollections = client.db("eduLearn").collection("courses");
    const enrollmentsCollection = client
      .db("eduLearn")
      .collection("enrollments");

    //Course related APIs

    app.get("/courses", async (req, res) => {
      // getting courses based on condition (instructor email)
      const email = req.query.email;
      const query = {};
      if (email) {
        query.instructorEmail = email;
      }

      const cursor = courseCollections.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    //get latest course
    app.get("/latest", async (req, res) => {
      const cursor = courseCollections.find().sort({ _id: -1 }).limit(6);
      const result = await cursor.toArray();
      res.send(result);
    });

    //popular courses api
    app.get("/popular", async (req, res) => {
      const courses = await courseCollections
        .find()
        .sort({ enrolledCount: -1 })
        .limit(6)
        .toArray();
      res.send(courses);
    });

    //particular course id to see how many people have enrolled
    app.get(
      "/courses/enrollments",
      verifyFirebaseToken,
      verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;

        const query = { instructorEmail: email };
        const courses = await courseCollections.find(query).toArray();

        //not a good way to find enrollments
        for (const course of courses) {
          const enrollmentsQuery = { courseId: course._id.toString() };
          const enrollmentsCount = await enrollmentsCollection.countDocuments(
            enrollmentsQuery
          );
          course.enrollmentsCount = enrollmentsCount;
        }

        res.send(courses);
      }
    );

    //find/get a single course for details
    app.get("/course/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const course = await courseCollections.findOne(query);

      if (!course) {
        return res.status(404).send({ message: "Course not found" });
      }
      const seatsLeft =
        parseInt(course.totalSeats) - (course.enrolledCount || 0);
      res.send({ ...course, seatsLeft });
    });

    app.post("/courses", async (req, res) => {
      const course = {
        ...req.body,
        publishDate: new Date(),
      };
      const result = await courseCollections.insertOne(course);
      res.send(result);
    });

    //delete operation for course
    app.delete("/course/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await courseCollections.deleteOne(query);
      res.send(result);
    });

    //update operation for course
    app.put("/course/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedCourse = req.body;
      const updatedDoc = {
        $set: updatedCourse,
      };
      const result = await courseCollections.updateOne(
        filter,
        updatedDoc,
        options
      );

      res.send(result);
    });

    //enrollments related APIs

    app.get("/enrollments", verifyFirebaseToken,verifyTokenEmail, async (req, res) => {
      const email = req.query.email;

      const query = {
        student: email,
      };
      const result = await enrollmentsCollection.find(query).toArray();

      //bad way to aggregate data
      for (const enrollment of result) {
        const courseId = enrollment.courseId;
        const courseQuery = { _id: new ObjectId(courseId) };
        const course = await courseCollections.findOne(courseQuery);

        enrollment.title = course.title;
        enrollment.instructorName = course.instructorName;
        enrollment.duration = course.duration;
      }
      res.send(result);
    });

    //checked if enrollments already exist in our server
    app.get("/enrollments/check", async (req, res) => {
      const { email, courseId } = req.query;
      const exists = await enrollmentsCollection.findOne({
        courseId,
        student: email,
      });
      res.send({ enrolled: !!exists, enrollmentId: exists?._id });
    });

    app.get("/enrollments/count", async (req, res) => {
      const email = req.query.email;
      const count = await enrollmentsCollection.countDocuments({
        student: email,
      });
      res.send({ count });
    });

    //save enrollments in the database
    app.post("/enrollments", async (req, res) => {
      const { courseId, student } = req.body;

      // Check if already enrolled
      const existing = await enrollmentsCollection.findOne({
        courseId,
        student,
      });
      if (existing) {
        return res.status(400).send({ message: "Already enrolled" });
      }

      // Check if user has enrolled in 3 courses
      const activeCount = await enrollmentsCollection.countDocuments({
        student,
      });
      if (activeCount >= 3) {
        return res
          .status(400)
          .send({ message: "You can only enroll in 3 courses" });
      }

      // Insert new enrollment
      const enrollment = {
        courseId,
        student,
        enrolledAt: new Date(),
        status: "Active",
      };

      const result = await enrollmentsCollection.insertOne(enrollment);

      // Safely increment count
      await courseCollections.updateOne(
        { _id: new ObjectId(courseId) },
        { $inc: { enrolledCount: 1 } }
      );

      res.send(result);
    });

    //delete an enrollment
    app.delete("/enrollments/:id", async (req, res) => {
      const id = req.params.id;

      const enrollment = await enrollmentsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!enrollment) {
        return res.status(404).send({ message: "Enrollment not found" });
      }

      // Delete enrollment first
      const deleteResult = await enrollmentsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      // Decrement count only if it’s greater than 0
      await courseCollections.updateOne(
        { _id: new ObjectId(enrollment.courseId), enrolledCount: { $gt: 0 } },
        { $inc: { enrolledCount: -1 } }
      );

      res.send(deleteResult);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Welcome to Edu-Learn-Server");
});

app.listen(port, () => {
  console.log(`The server is running on port: ${port}`);
});
