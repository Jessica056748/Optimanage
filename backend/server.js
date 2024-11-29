// Import Express and CORS
const express = require('express');     // Import express library (server creation, route definition, handles HTTP requests)
const cors = require('cors');           // Import cross-origin resource sharing library (allows backend to frontend comms on a diff domain or port)
const pool = require('./db');           // Import the connection pool from db.js
const bcrypt = require('bcrypt');       // Import bcrypt for password hashing
const jwt = require('jsonwebtoken');    // Import jwt for authentication handling


// Create an instance of express
const app = express();                    // Main object of the server (express instance)
const PORT = process.env.PORT || 5000;    // process.env.PORT allows for dynamic assignment in a production environment 

// Middleware
app.use(cors());            // Allows frontend to make API requests to your backend (http://localhost:5000)
app.use(express.json());    // Middleware to parse JSON data, "understanding JSON payloads"

// Middleware to verify JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];        // Get authorization header
    const token = authHeader && authHeader.split(' ')[1];   // Extract token 

    if (!token) {
        return res.status(401).json({error: 'Access denied. Token missing.'});
    }
    try {
        // Verify the token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Attach decoded payload to the request object
        next(); // Continue, skipping rest of the code

    } catch (error) {
        return res.status(403).json({error: 'Invalid or expired token.'});
    }
}

// Routes (Define a basic route)
app.get('/', (req, res) => {                // Response to a client's GET request
    res.send('Hello from the backend!');
});

// Test route for DB query
app.get('/test-db', async (req, res) => {
    try{
        const result = await pool.query('SELECT NOW()'); // Test query to get the current time
        res.json({message: 'Database connection successful!', time: result.rows[0].now});
    } catch (error) {
        console.error('Database connection error: ', error.message);
        res.status(500).json({error: 'Database connection failed.'});
    }
});

// createManager function (POST method)
app.post('/create-manager', async (req, res) => {
    const {sin, name, phone, address, departmentid, email, password} = req.body;          // Get parameters from request body
    const queryText = `
        SELECT *
        FROM MANAGER
        WHERE sin = $1 OR email = $2
        `;                     // Parameterized query to avoid SQL injections                      
    const values = [sin, email]; // Parameterized username to avoid SQL injections
    const insertQuery = `
        INSERT INTO MANAGER (sin, name, phone, address, departmentid, email, password)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING sin;
    `;
    try {
        // 1. Sanitize user inputs
        if (!sin || !address || !email || !name || !password) {
            return res.status(400).json({error: 'SIN, name, address, email and password are required'}); 
        }
        // 2. Hash the password using bcrypt
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds); 

        // 3. Check if SIN or email already exists
        const result = await pool.query(queryText, values); 

        if (result.rows.length > 0) { // If username exists (there will be a database object in result)
            return res.status(400).json({error: 'SIN or E-mail already exists'});
        }

        insertValues = [sin, name, phone, address, departmentid, email, hashedPassword];
        // 4. Insert a new manager if the username doesn't exist
        const insertResult = await pool.query(insertQuery, insertValues);

        // 5. Respond with success
        res.status(201).json({
            message: 'Manager account created successfully',
            managerId: insertResult.rows[0].sin
        });
    } catch (error) {
        console.error('Error creating manager', error.message);
        res.status(500).json({error: 'Failed to create Manager'});
    }
});

// authenticate(email, password) function (POST method)
app.post('/authenticate', async (req, res) => {
    const {email, password} = req.body;             // Get email and password values from request body

    // parameterized query to retrieve user by email
    const managerQuery = `
        SELECT 'manager' AS role, *
        FROM manager
        WHERE email = $1
        `;
    const employeeQuery = `
        SELECT 'employee' AS role, *
        FROM employee
        WHERE email = $1
        `;
    const values = [email];
    try {
        // 1. Sanitize user inputs
        if (!email || !password) {
            return res.status(400).json({error: 'Email and password are required'});
        }
        // 2. Query database to find manager by email, storing full tuple in result
        const managerResult = await pool.query(managerQuery, values);

        // 3. Query the employee table if not found in the manager table
        let user = null;
        if (managerResult.rows.length > 0) { // If found in manager table
            user = managerResult.rows[0]; // Manager tuple
        } else {
            const employeeResult = await pool.query(employeeQuery, values)
            if (employeeResult.rows.length > 0) { // If found in employee table
                user = employeeResult.rows[0]; // employee tuple
            }
        }

        // 4. Check if user exists
        if (!user) {    // If user is null
            return res.status(400).json({error: 'Email not found in Manager or Employee records'});
        }

        // 4. Compare hashed password
        const passwordMatch = await bcrypt.compare(password, user.password); // Returns a boolean stating whether it's a match (T) or not (F)
        if (!passwordMatch) {
            return res.status(401).json({error: 'Invalid password'});
        }

        // 5. Generate a JWT token
        const tokenPayLoad = {
            sin: user.sin,
            name: user.name,
            email: user.email,
            role: user.role
        };
        const token = jwt.sign(tokenPayLoad, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN,
        });

        // 6. Return success message and token (with name in case we want it to say "Welcome, <name>!")
        const {name, role} = user;
        res.status(200).json({
            message: 'Authentication successful',
            user: {name, role},
            token // Include the JWT token in the response
        });  // Object shorthand in case we want to return more values later

    } catch (error) {
        console.error('Error authenticating manager: ', error.message);
        res.status(500).json({error: 'Failed to authenticate'});
    }
})

// Add employee function
app.post('/add-employee', async (req, res) => {
    const {sin, name, phone, address, departmentid, email, password, msin, rate} = req.body;          // Get parameters from request body
    const queryText = `
        SELECT *
        FROM employee
        WHERE sin = $1 OR email = $2
        `;                     // Parameterized query to avoid SQL injections                      
    const values = [sin, email]; // Parameterized username to avoid SQL injections
    const insertQuery = `
        INSERT INTO employee (sin, name, phone, address, departmentid, email, password, msin, rate)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING sin;
    `;
    const managerCheckQuery = `
        SELECT *
        FROM manager
        WHERE sin = $1
        `;
    const managerSin = [msin];

    const departmentidQuery = `
        SELECT *
        FROM department
        WHERE departmentid = $1
        `;
    const departmentidValue = [departmentid];
    try {
        // Sanitize user inputs
        if (!sin || !address || !email || !name || !password || !msin || !rate || !departmentid) { 
            return res.status(400).json({error: 'SIN, name, address, email, manager SIN, rate and password are required'}); 
        }
        // Check if manager exists in Schema
        const managerResult = await pool.query(managerCheckQuery, managerSin);
        if (managerResult.rows.length === 0) {
            return res.status(400).json({error: 'Invalid Manager SIN'});
        }
        // Check if departmentid exists in Schema
        const departmentidResult = await pool.query(departmentidQuery, departmentidValue);
        if (departmentidResult.rows.length === 0) {
            return res.status(400).json({error: 'Invalid department ID'});
        }
        // Hash the password using bcrypt
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds); 

        // Check if SIN or email already exists
        const result = await pool.query(queryText, values); 

        if (result.rows.length > 0) { // If username exists (there will be a database object in result)
            return res.status(400).json({error: 'SIN or E-mail already exists'});
        }

        insertValues = [sin, name, phone, address, departmentid, email, hashedPassword, msin, rate];
        // Insert a new manager if the username doesn't exist
        const insertResult = await pool.query(insertQuery, insertValues);

        // Respond with success
        res.status(201).json({
            message: 'Employee account created successfully',
            employee: {
                sin: insertResult.rows[0].sin,
                name,
                email
            }
        });
    } catch (error) {
        console.error('Error creating employee', error.message);
        res.status(500).json({error: 'Failed to create Employee'});
    }
});

// addRequest() function
app.post('/add-request', authenticateToken, async (req, res) => {
    const {sin} = req.user;                      // Extract sin from req.user (after token validity)
    const {requestId, week, day, type} = req.body; // Extract parameters from request body
    
    // Validation queries
    const toSinQuery = `
        SELECT msin
        FROM employee
        WHERE sin = $1
        `;
    try {
        if (!week || !day || !type) {
            return res.status(400).json({error : 'Week, day, and type are required.'});
        }
        // Query database for the manager SIN (msin)
        const result = await pool.query(toSinQuery, [sin]);
        if (result.rows.length === 0) {
            return res.status(400).json({error: 'Employee SIN not found'});
        }
        // Else we have the row that inlcudes msin
        const toSin = result.rows[0].msin;      // Manager's sin

        const insertQuery = `
            INSERT INTO request (week, day, fromSin, toSin, type)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
            `;
        
        const insertResult = await pool.query(insertQuery, [week, day, sin, toSin, type]);

        // Create a notification for the manager
        const notificationQuery = `
            INSERT INTO notifications (to_msin, request_id, message)
            VALUES ($1, $2, $3)
            `;
        const notificationMessage = `New request from employee ${sin} for ${type}`;
        const notificationValues = [toSin, requestId, notificationMessage];
        await pool.query(notificationQuery, notificationValues);

        res.status(201).json({message: 'Request created successfully and manager notified '});

    } catch (error) {
        console.error('Error adding request: ', error.message);
        res.status(500).json({error: 'Failed to add request'});
    }



});

// Start the server
app.listen(PORT, () => {                    // PORT to listen for requests
    console.log(`Server is running on http://localhost:${PORT}`);
});