/**
 * Copyright 2018, Google, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';
console.log(`***Image processing is starting up***`);

// Imports
const process = require('process'); // Required for mocking environment variables
const request = require('request');
const VisionResponse = require('../../../cloud/controller/js/vision-response');
const BoundingBox = require('../../../cloud/controller/js/bounding-box');

// Constants
const APP_URL = `http://${process.env.INFERENCE_IP}`;
const HTTP_PORT = process.env.HTTP_PORT;
const INFERENCE_URL = process.env.INFERENCE_URL;
const OBJECT_INFERENCE_API_URL = APP_URL + ':' + HTTP_PORT + INFERENCE_URL;
// User credentials to authenticate to remote Inference VM service
const INFERENCE_USER_NAME = process.env.INFERENCE_USER_NAME;
const INFERENCE_PASSWORD = process.env.INFERENCE_PASSWORD;
const ALL_OBJECT_LABELS = process.env.ALL_OBJECT_LABELS.split(" ");

/************************************************************
 Scan all files in the bucket
 Great examples of API use can be found here:
 https://github.com/googleapis/nodejs-storage/blob/99e3b17f0b12ea66ed46060ca291124b10772111/samples/files.js#L26
 ************************************************************/
async function processAllFiles(bucketName) {
  const Storage = require('@google-cloud/storage');
  const storage = new Storage(process.env.PROJECT);
  const [files] = await storage.bucket(bucketName).getFiles();
  let i = 1;
  
  files.forEach(file => {
    //  TODO - for now terminate after few calls - debugging time
    if (i < 2) {
      console.log('processAllFiles(): #' + i);
      processOneFile(bucketName, file.name);
    }
    i++;
  });
  
  console.log('processAllFiles(): Processed total of ' + i + " files.");
}

/************************************************************
 Process one file
 ************************************************************/
async function processOneFile(bucketName, fileName) {
  console.log('processOneFile(): ' + fileName);
  let visionResponse = await recognizeObjects('gs://' + bucketName + '/' + fileName);
  console.log('processOneFile(): vision response: ' + JSON.stringify(visionResponse));
  
  for (let label of ALL_OBJECT_LABELS) {
    let found = findObject(label, visionResponse);
    console.log('Searching for "' + label + '": ' + found);
    
  }
  
}

/************************************************************
 Based on the list of object locations, find the object closest to observer.
 This assumes that all objects of this label are the same size
 Input:
 - object label
 - list of object bounding boxes found by Object Detection
 Output:
 - True if the object has been found, False otherwise
 ************************************************************/
function findObject(objectType, visionResponse)
{
  // console.log("findObject(): Looking for an object of type <" + objectType + ">");
  // console.log('findObject(): vision response: ' + JSON.stringify(visionResponse));
  
  // Iterate over all of the objects in the list and find and compare all of the needed type
  for (let i = visionResponse.bBoxes.length; i--;) {
    // Is this the right object type?
    if (visionResponse.bBoxes[i].label.toLocaleLowerCase().indexOf(objectType.toLowerCase()) >= 0) {
      return true;
    }
  }
  return false;
}

/************************************************************
 Call Vision API to recognize objects in the file
 ************************************************************/
function recognizeObjects(gcsPath) {
  console.log('recognizeObjects(): ' + gcsPath);
  // return {z: 'aaa'};
  
  // Call REST API Object Detection
  // this returns a Promise which when resolved returns the VisionResponse object
  return recognizeObjectAPIAsync(gcsPath)
  .then((response) => {
    return Promise.resolve()
    .then(() => {
      return createVisionResponse(response);
    });
  })
  .catch((error) => {
    console.log("recognizeObjects(): Error calling remote Object Detection API: " + error);
    // In case of an error, return empty response
    return new VisionResponse();
  });
}

/************************************************************
 Generate response from the ML Vision
 Input:
 - jsonAPIResponse - response from the Vision API
 Output:
 - VisionResponse - Coordinates of various objects that were recognized
 ************************************************************/
function createVisionResponse(jsonAPIResponse) {
  let response = new VisionResponse();
  const objResponse = JSON.parse(jsonAPIResponse);
  
  for (let key in objResponse) {
    for (let i = 0; i < objResponse[key].length; i++) {
      //console.log("objResponse[key]["+i+"]: "+JSON.stringify(objResponse[key][i]));
      const bBox = new BoundingBox(key, objResponse[key][i]["x"], objResponse[key][i]["y"], objResponse[key][i]["w"], objResponse[key][i]["h"], objResponse[key][i]["score"]);
      response.addBox(bBox);
    }
  }
  return response;
}

/************************************************************
 Generate response from the ML Vision
 Input:
 - sensorMessage - message from the car with sensor data
 Output:
 -
 ************************************************************/
function recognizeObjectAPIAsync(gcsURI) {
  return new Promise(function (resolve, reject) {
    
    if (!gcsURI) {
      reject("Error: No gcURI found in sensorMessage");
      
    } else if (!gcsURI.startsWith("gs://")) {
      reject("Error: gcsURI must start with gs://");
      
    } else {
      // Example request for the inference VM:
      // http://xx.xx.xx.xx:8082/v1/objectInference?gcs_uri=gs%3A%2F%2Fcamera-9-roman-test-oct9%2Fimage1.jpg
      const apiUrl = OBJECT_INFERENCE_API_URL + "?gcs_uri=" + encodeURIComponent(gcsURI);
      const auth = {user: INFERENCE_USER_NAME, pass: INFERENCE_PASSWORD};
      
      // Measure the time it takes to call inference API
      const startTime = Date.now();
      
      request({uri: apiUrl, auth: auth}, function (err, response, body) {
        if (err) {
          console.log("!!! ERROR !!! calling remote ML API: " + err + ". Please verify that your Inference VM and the App are up and running and proper HTTP port is open in the firewall.");
          reject(err);
        } else {
          console.log("Vision API call took " + (Date.now() - startTime) + " ms. URI: " + apiUrl);
          if (response.statusCode !== 200) {
            reject("Error: Received  " + response.statusCode + " from API");
          } else {
            resolve(body);
          }
        }
      });
    }
  });
}

/************************************************************
 MAIN
 ************************************************************/
console.log("Image processing started...");

let files = processAllFiles(process.env.CLOUD_BUCKET);

console.log("Image processing is in progress...");