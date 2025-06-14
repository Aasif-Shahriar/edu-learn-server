const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;

//middleware

app.get("/", (req, res) => {
  res.send("Welcome to Edu-Learn-Server");
});

app.listen(port, () => {
  console.log(`The server is running on port: ${port}`);
});
