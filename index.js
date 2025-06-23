require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

//middleware
app.use(cors());
app.use(express.json());

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

    //get all the courses
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

    //get limited course
    app.get("/latest", async (req, res) => {
      const cursor = courseCollections.find().sort({ _id: -1 }).limit(6);
      const result = await cursor.toArray();
      res.send(result);
    });
    //particular course id to see how many people have enrolled
    app.get("/courses/enrollments", async (req, res) => {
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
    });

    //popular courses api
    app.get("/courses/popular", async (req, res) => {
      const courses = await courseCollections
        .find()
        .sort({ enrolledCount: -1 })
        .limit(6)
        .toArray();
      res.send(courses);
    });

    //find/get a single course for details
    app.get("/courses/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await courseCollections.findOne(query);
      res.send(result);
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
    app.delete("/courses/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await courseCollections.deleteOne(query);
      res.send(result);
    });

    //update operation for course
    app.put("/courses/:id", async (req, res) => {
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
    app.get("/enrollments", async (req, res) => {
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

    app.post("/enrollments", async (req, res) => {
      const enrollment = {
        ...req.body,
        enrolledAt: new Date(),
        status: "Active",
      };
      const result = await enrollmentsCollection.insertOne(enrollment);

      //update enroll count
      await courseCollections.updateOne(
        { _id: new ObjectId(enrollment.courseId) },
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

      const query = { _id: new ObjectId(id) };
      const result = await enrollmentsCollection.deleteOne(query);

      //update enrollments count after delete
      await courseCollections.updateOne(
        { _id: new ObjectId(enrollment.courseId) },
        { $inc: { enrolledCount: -1 } }
      );
      res.send(result);
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
