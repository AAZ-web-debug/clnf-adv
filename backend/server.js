require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not configured');
}

app.use(cors());
app.use(express.json());

/* =========================
   UPLOADS
========================= */

const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

app.use('/uploads', express.static(uploadsDir));

/* =========================
   DATABASE
========================= */

const db = new Database('campus_lnf.db');
db.pragma('foreign_keys = ON');

/* USERS */

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`).run();

/* ITEMS */

db.prepare(`
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  finder_id TEXT NOT NULL,

  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,

  verification_detail TEXT,

  image_path TEXT,

  location TEXT NOT NULL,

  status TEXT DEFAULT 'found',

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`).run();

/* CLAIMS */

db.prepare(`
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  item_id INTEGER NOT NULL,
  claimer_id TEXT NOT NULL,

  claim_reason TEXT,
  identifier_description TEXT,

  lost_location TEXT,
  lost_date TEXT,

  additional_proof TEXT,

  status TEXT DEFAULT 'pending',

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(item_id)
  REFERENCES items(id)
)
`).run();


/* CLAIM CONTACTS */

db.prepare(`
CREATE TABLE IF NOT EXISTS claim_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  claim_id INTEGER NOT NULL UNIQUE,

  email TEXT,
  phone TEXT,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(claim_id)
  REFERENCES claims(id)
)
`).run();

/* CONVERSATIONS */

db.prepare(`
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  item_id INTEGER NOT NULL,
  claim_id INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'claimed' or 'additional_info'

  participant_one TEXT NOT NULL,
  participant_two TEXT NOT NULL,

  status TEXT DEFAULT 'active', -- 'active' or 'closed'

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(item_id) REFERENCES items(id),
  FOREIGN KEY(claim_id) REFERENCES claims(id)
)
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_conversations_participants 
  ON conversations(participant_one, participant_two)
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_conversations_item_claim 
  ON conversations(item_id, claim_id)
`).run();

/* MESSAGES */

db.prepare(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  conversation_id INTEGER NOT NULL,
  sender_id TEXT NOT NULL,
  message TEXT NOT NULL,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME DEFAULT NULL,

  FOREIGN KEY(conversation_id) REFERENCES conversations(id)
)
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_messages_conv 
  ON messages(conversation_id, created_at)
`).run();

/* NOTIFICATIONS */

db.prepare(`
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,

  item_id INTEGER,
  claim_id INTEGER,
  conversation_id INTEGER,

  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_notifications_user 
  ON notifications(user_id, is_read)
`).run();

/* HELPER: CREATE NOTIFICATION */
function createNotification({
  user_id,
  type,
  title,
  message,
  item_id = null,
  claim_id = null,
  conversation_id = null
}) {
  try {
    db.prepare(`
      INSERT INTO notifications (
        user_id,
        type,
        title,
        message,
        item_id,
        claim_id,
        conversation_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      user_id,
      type,
      title,
      message,
      item_id,
      claim_id,
      conversation_id
    );
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
}


/* =========================
   MULTER
========================= */

const storage = multer.diskStorage({
  destination: uploadsDir,

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    const safeName =
      `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;

    cb(null, safeName);
  }
});

const upload = multer({
  storage,

  limits: {
    fileSize: 5 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(
        new Error('Only JPEG, PNG, WEBP and GIF images are allowed')
      );
    }

    cb(null, true);
  }
});

/* =========================
   AUTH MIDDLEWARE
========================= */

const authenticateToken = (
  req,
  res,
  next
) => {

  const token =
    req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'No token'
    });
  }

  jwt.verify(
    token,
    JWT_SECRET,
    (err, user) => {

      if (err) {
        return res.status(403).json({
          error: 'Invalid token'
        });
      }

      req.user = user;
      next();
    }
  );
};

/* =========================
   REGISTER
========================= */

app.post(
  '/api/register',
  async (req, res) => {
    try {
      const { userId, password } = req.body;

      // Validate input types
      if (
        typeof userId !== 'string' ||
        typeof password !== 'string'
      ) {
        return res.status(400).json({
          error: 'User ID and password are required'
        });
      }

      const cleanUserId = userId.trim();

      // Basic validation
      if (!cleanUserId || !password) {
        return res.status(400).json({
          error: 'User ID and password are required'
        });
      }

      // Prevent excessively large input
      if (cleanUserId.length > 50) {
        return res.status(400).json({
          error: 'User ID must be 50 characters or less'
        });
      }

      if (password.length > 128) {
        return res.status(400).json({
          error: 'Password must be 128 characters or less'
        });
      }

      // Check if user already exists
      const existingUser = db.prepare(`
        SELECT id
        FROM users
        WHERE user_id = ?
      `).get(cleanUserId);

      if (existingUser) {
        return res.status(400).json({
          error: 'User already exists'
        });
      }

      // Hash password
      const hashed = await bcrypt.hash(
        password,
        10
      );

      db.prepare(`
        INSERT INTO users (
          user_id,
          password
        )
        VALUES (?, ?)
      `).run(
        cleanUserId,
        hashed
      );

      res.json({
        message: 'Registered'
      });

    } catch (err) {
      console.error('Registration error:', err);

      res.status(500).json({
        error: 'Registration failed'
      });
    }
  }
);

/* =========================
   LOGIN
========================= */

app.post(
  '/api/login',
  async (req, res) => {
    try {
      const { userId, password } = req.body;

      if (
        typeof userId !== 'string' ||
        typeof password !== 'string'
      ) {
        return res.status(400).json({
          error: 'Invalid user ID or password'
        });
      }

      const cleanUserId = userId.trim();

      if (!cleanUserId || !password) {
        return res.status(400).json({
          error: 'Invalid user ID or password'
        });
      }

      const user = db.prepare(`
        SELECT *
        FROM users
        WHERE user_id = ?
      `).get(cleanUserId);

      if (!user) {
        return res.status(401).json({
          error: 'Invalid user ID or password'
        });
      }

      const valid = await bcrypt.compare(
        password,
        user.password
      );

      if (!valid) {
        return res.status(401).json({
          error: 'Invalid user ID or password'
        });
      }

      const token = jwt.sign(
        {
          userId: user.user_id,
          role: user.role
        },
        JWT_SECRET,
        {
          expiresIn: '2h'
        }
      );

      res.json({
        token,
        role: user.role
      });

    } catch (err) {
      console.error('Login error:', err);

      res.status(500).json({
        error: 'Login failed'
      });
    }
  }
);

/* =========================
   CURRENT USER
========================= */

app.get(
  '/api/me',
  authenticateToken,
  (req, res) => {

    res.json({
      userId:
        req.user.userId,
      role:
        req.user.role
    });

  }
);

/* =========================
   CREATE ITEM
========================= */

app.post(
  '/api/items',
  authenticateToken,
  upload.single('image'),
  (req, res) => {

    const {
      title,
      category,
      description,
      verification_detail,
      location
    } = req.body;

    if (!req.file) {
  return res.status(400).json({
    error: 'No image uploaded'
  });
}

const cleanTitle =
  typeof title === 'string' ? title.trim() : '';

const cleanCategory =
  typeof category === 'string' ? category.trim() : '';

const cleanLocation =
  typeof location === 'string' ? location.trim() : '';

if (!cleanTitle || !cleanCategory || !cleanLocation) {
  // Remove uploaded image if validation fails
  if (req.file?.path && fs.existsSync(req.file.path)) {
    fs.unlinkSync(req.file.path);
  }

  return res.status(400).json({
    error: 'Title, category and location are required'
  });
}

if (
  cleanTitle.length > 100 ||
  cleanCategory.length > 50 ||
  cleanLocation.length > 150
) {
  if (req.file?.path && fs.existsSync(req.file.path)) {
    fs.unlinkSync(req.file.path);
  }

  if (cleanTitle.length > 100) {
    return res.status(400).json({
      error: 'Title must be 100 characters or less'
    });
  }

  if (cleanCategory.length > 50) {
    return res.status(400).json({
      error: 'Category must be 50 characters or less'
    });
  }

  return res.status(400).json({
    error: 'Location must be 150 characters or less'
  });
}

    const imagePath =
      `/uploads/${req.file.filename}`;

    db.prepare(`
      INSERT INTO items (
        finder_id,
        title,
        category,
        description,
        verification_detail,
        image_path,
        location,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
  req.user.userId,
  cleanTitle,
  cleanCategory,
  typeof description === 'string' ? description.trim() : null,
  typeof verification_detail === 'string'
    ? verification_detail.trim()
    : null,
  imagePath,
  cleanLocation,
  'found'
);

    res.json({
      message:
        'Item uploaded successfully'
    });
  }
);

/* =========================
   ALL ITEMS
========================= */

app.get(
  '/api/items',
  authenticateToken,
  (req, res) => {

    const items = db.prepare(`
      SELECT
        id,
        finder_id,
        title,
        category,
        description,
        image_path,
        location,
        status,
        created_at
      FROM items
      WHERE status = 'found'
      ORDER BY created_at DESC
    `).all();

    res.json(items);
  }
);

/* =========================
   SINGLE ITEM
========================= */

app.get(
  '/api/items/:id',
  authenticateToken,
  (req, res) => {

    const item =
      db.prepare(`
        SELECT *
        FROM items
        WHERE id = ?
      `).get(
        req.params.id
      );

    if (!item) {
      return res.status(404).json({
        error:
          'Item not found'
      });
    }

    res.json(item);
  }
);

/* =========================
   PUBLIC ITEMS
========================= */

app.get(
  '/api/public-items',
  (req, res) => {

    const limit = Math.min(
      Math.max(
        parseInt(req.query.limit, 10) || 4,
        1
      ),
      20
    );

    const items = db.prepare(`
      SELECT
        id,
        title,
        category,
        description,
        image_path,
        location,
        status,
        created_at
      FROM items
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);

    res.json(items);
  }
);

app.get(
  '/api/returned-items',
  (req, res) => {

    const items = db.prepare(`
      SELECT
        id,
        title,
        category,
        description,
        image_path,
        location,
        status,
        created_at
      FROM items
      WHERE status = 'returned'
      ORDER BY created_at DESC
    `).all();

    res.json(items);

  }
);

/* =========================
   CREATE CLAIM
========================= */

app.post(
  '/api/claims',
  authenticateToken,
  (req, res) => {

    const {
      item_id,
      claim_reason,
      identifier_description,
      lost_location,
      lost_date,
      additional_proof
    } = req.body;

    // Check that the item exists
    const item = db.prepare(`
      SELECT *
      FROM items
      WHERE id = ?
    `).get(item_id);

    if (!item) {
      return res.status(404).json({
        error: 'Item not found'
      });
    }

    // Item must still be available
    if (item.status !== 'found') {
      return res.status(400).json({
        error: 'This item is no longer available for claims'
      });
    }

    // Finder cannot claim their own item
    if (item.finder_id === req.user.userId) {
      return res.status(400).json({
        error: 'You cannot claim an item you reported'
      });
    }

    // Prevent duplicate claims from the same user
    const existingClaim = db.prepare(`
      SELECT id
      FROM claims
      WHERE item_id = ?
        AND claimer_id = ?
    `).get(
      item_id,
      req.user.userId
    );

    if (existingClaim) {
      return res.status(400).json({
        error: 'You have already submitted a claim for this item'
      });
    }

    const result = db.prepare(`
      INSERT INTO claims (
        item_id,
        claimer_id,
        claim_reason,
        identifier_description,
        lost_location,
        lost_date,
        additional_proof,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item_id,
      req.user.userId,
      claim_reason,
      identifier_description,
      lost_location,
      lost_date,
      additional_proof,
      'pending'
    );

    const claimId = result.lastInsertRowid;

    // Send notification to reporter/finder
    createNotification({
      user_id: item.finder_id,
      type: 'claim_submitted',
      title: 'New Claim Received',
      message: `Someone has submitted a claim for "${item.title}".`,
      item_id: item.id,
      claim_id: claimId
    });

    // Send notification to claimant
    createNotification({
      user_id: req.user.userId,
      type: 'claim_submitted',
      title: 'Claim Submitted',
      message: `Your claim for "${item.title}" has been submitted successfully.`,
      item_id: item.id,
      claim_id: claimId
    });

    res.json({
      message: 'Claim submitted',
      claimId
    });
  }
);

/* =========================
   GET CLAIMS
========================= */

app.get(
  '/api/claims',
  authenticateToken,
  (req, res) => {

    const claims = db.prepare(`
      SELECT
        claims.*,
        items.title,
        items.category,
        items.verification_detail,
        items.finder_id
      FROM claims
      JOIN items
      ON claims.item_id = items.id
      WHERE items.finder_id = ?
      ORDER BY claims.created_at DESC
    `).all(
      req.user.userId
    );

    res.json(claims);

  }
);

/* =========================
   MY CLAIMS
========================= */

app.get(
  '/api/my-claims',
  authenticateToken,
  (req, res) => {

    const claims = db.prepare(`
      SELECT
        claims.id,
        claims.item_id,
        claims.status,
        claims.created_at,
        items.title,
        items.category,
        items.location,
        items.status AS item_status
      FROM claims
      JOIN items
      ON claims.item_id = items.id
      WHERE claims.claimer_id = ?
      ORDER BY claims.created_at DESC
    `).all(
      req.user.userId
    );

    res.json(claims);
  }
);

/* =========================
   MY CLAIM CONTACT
========================= */

app.get(
  '/api/my-claims/:id/contact',
  authenticateToken,
  (req, res) => {

    const contact = db.prepare(`
      SELECT
        claim_contacts.email,
        claim_contacts.phone,
        claim_contacts.created_at
      FROM claim_contacts
      JOIN claims
      ON claim_contacts.claim_id = claims.id
      WHERE claim_contacts.claim_id = ?
        AND claims.claimer_id = ?
        AND claims.status = 'approved'
    `).get(
      req.params.id,
      req.user.userId
    );

    if (!contact) {
      return res.status(404).json({
        error:
          'Contact details are not available'
      });
    }

    res.json(contact);
  }
);

/* =========================
   REQUEST ADDITIONAL INFO
========================= */

app.post(
  '/api/claims/:id/request-info',
  authenticateToken,
  (req, res) => {
    try {
      const claim = db.prepare(`
        SELECT *
        FROM claims
        WHERE id = ?
      `).get(req.params.id);

      if (!claim) {
        return res.status(404).json({
          error: 'Claim not found'
        });
      }

      if (
        claim.status !== 'pending' &&
        claim.status !== 'additional_info_requested'
      ) {
        return res.status(400).json({
          error: 'Only pending or active info requests can be updated'
        });
      }

      const item = db.prepare(`
        SELECT *
        FROM items
        WHERE id = ?
      `).get(claim.item_id);

      if (!item) {
        return res.status(404).json({
          error: 'Item not found'
        });
      }

      if (item.finder_id !== req.user.userId) {
        return res.status(403).json({
          error: 'Only the finder can request additional information'
        });
      }

      db.prepare(`
        UPDATE claims
        SET status = 'additional_info_requested'
        WHERE id = ?
      `).run(req.params.id);

      let conv = db.prepare(`
        SELECT *
        FROM conversations
        WHERE item_id = ?
          AND claim_id = ?
          AND type = 'additional_info'
      `).get(claim.item_id, claim.id);

      if (!conv) {
        const resConv = db.prepare(`
          INSERT INTO conversations (
            item_id,
            claim_id,
            type,
            participant_one,
            participant_two,
            status
          )
          VALUES (?, ?, 'additional_info', ?, ?, 'active')
        `).run(
          claim.item_id,
          claim.id,
          item.finder_id,
          claim.claimer_id
        );

        conv = db.prepare(`
          SELECT *
          FROM conversations
          WHERE id = ?
        `).get(resConv.lastInsertRowid);
      } else {
        db.prepare(`
          UPDATE conversations
          SET status = 'active',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(conv.id);
      }

      createNotification({
        user_id: claim.claimer_id,
        type: 'claim_additional_info',
        title: 'Additional Info Requested',
        message: `The reporter requested additional information for your claim on "${item.title}".`,
        item_id: item.id,
        claim_id: claim.id,
        conversation_id: conv.id
      });

      res.json({
        message: 'Additional information requested',
        conversationId: conv.id
      });

    } catch (err) {
      console.error('Request info error:', err);
      res.status(500).json({
        error: 'Failed to request additional info'
      });
    }
  }
);

/* =========================
   APPROVE CLAIM
========================= */

app.post(
  '/api/claims/:id/approve',
  authenticateToken,
  (req, res) => {
    try {
      const { email, phone } = req.body;

      if (
        (!email || !email.trim()) &&
        (!phone || !phone.trim())
      ) {
        return res.status(400).json({
          error: 'Please provide an email or phone number'
        });
      }

      const claim = db.prepare(`
        SELECT *
        FROM claims
        WHERE id = ?
      `).get(req.params.id);

      if (!claim) {
        return res.status(404).json({
          error: 'Claim not found'
        });
      }

      if (
        claim.status !== 'pending' &&
        claim.status !== 'additional_info_requested'
      ) {
        return res.status(400).json({
          error: 'Only pending or info-requested claims can be approved'
        });
      }

      const item = db.prepare(`
        SELECT *
        FROM items
        WHERE id = ?
      `).get(claim.item_id);

      if (!item) {
        return res.status(404).json({
          error: 'Item not found'
        });
      }

      if (item.finder_id !== req.user.userId) {
        return res.status(403).json({
          error: 'Only the finder can approve claims'
        });
      }

      if (item.status !== 'found') {
        return res.status(400).json({
          error: 'This item is no longer available'
        });
      }

      let claimedConvId = null;

      const approveClaim = db.transaction(() => {
        // Approve selected claim
        db.prepare(`
          UPDATE claims
          SET status = 'approved'
          WHERE id = ?
        `).run(req.params.id);

        // Find and reject other claims for this item
        const otherClaims = db.prepare(`
          SELECT * FROM claims
          WHERE item_id = ?
            AND id <> ?
            AND status IN ('pending', 'additional_info_requested')
        `).all(claim.item_id, req.params.id);

        for (const other of otherClaims) {
          db.prepare(`
            UPDATE claims
            SET status = 'rejected'
            WHERE id = ?
          `).run(other.id);

          db.prepare(`
            UPDATE conversations
            SET status = 'closed'
            WHERE claim_id = ?
              AND type = 'additional_info'
          `).run(other.id);

          createNotification({
            user_id: other.claimer_id,
            type: 'claim_rejected',
            title: 'Claim Rejected',
            message: `Your claim for "${item.title}" was rejected because another claim was approved.`,
            item_id: item.id,
            claim_id: other.id
          });
        }

        // Close additional_info conversation for this approved claim if it exists
        db.prepare(`
          UPDATE conversations
          SET status = 'closed'
          WHERE claim_id = ?
            AND type = 'additional_info'
        `).run(req.params.id);

        // Store contact details
        db.prepare(`
          INSERT INTO claim_contacts (
            claim_id,
            email,
            phone
          )
          VALUES (?, ?, ?)
        `).run(
          req.params.id,
          email?.trim() || null,
          phone?.trim() || null
        );

        // Mark item as returned
        db.prepare(`
          UPDATE items
          SET status = 'returned',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(claim.item_id);

        // Create or activate claimed conversation
        let conv = db.prepare(`
          SELECT *
          FROM conversations
          WHERE item_id = ?
            AND claim_id = ?
            AND type = 'claimed'
        `).get(claim.item_id, claim.id);

        if (!conv) {
          const resConv = db.prepare(`
            INSERT INTO conversations (
              item_id,
              claim_id,
              type,
              participant_one,
              participant_two,
              status
            )
            VALUES (?, ?, 'claimed', ?, ?, 'active')
          `).run(
            claim.item_id,
            claim.id,
            item.finder_id,
            claim.claimer_id
          );
          claimedConvId = resConv.lastInsertRowid;
        } else {
          db.prepare(`
            UPDATE conversations
            SET status = 'active',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(conv.id);
          claimedConvId = conv.id;
        }
      });

      approveClaim();

      // Notify approved claimant
      createNotification({
        user_id: claim.claimer_id,
        type: 'claim_approved',
        title: 'Claim Approved!',
        message: `Your claim for "${item.title}" has been approved. You can now chat with the reporter!`,
        item_id: item.id,
        claim_id: claim.id,
        conversation_id: claimedConvId
      });

      res.json({
        message: 'Claim approved and contact details shared',
        conversationId: claimedConvId
      });
    } catch (err) {
      console.error('Approve claim error:', err);
      res.status(500).json({
        error: 'Failed to approve claim'
      });
    }
  }
);

/* =========================
   REJECT CLAIM
========================= */

app.post(
  '/api/claims/:id/reject',
  authenticateToken,
  (req, res) => {
    try {
      const claim = db.prepare(`
        SELECT *
        FROM claims
        WHERE id = ?
      `).get(req.params.id);

      if (!claim) {
        return res.status(404).json({
          error: 'Claim not found'
        });
      }

      const item = db.prepare(`
        SELECT *
        FROM items
        WHERE id = ?
      `).get(claim.item_id);

      if (!item) {
        return res.status(404).json({
          error: 'Item not found'
        });
      }

      if (item.finder_id !== req.user.userId) {
        return res.status(403).json({
          error: 'Only the finder can reject claims'
        });
      }

      const result = db.prepare(`
        UPDATE claims
        SET status = 'rejected'
        WHERE id = ?
          AND status IN ('pending', 'additional_info_requested')
      `).run(req.params.id);

      if (result.changes === 0) {
        return res.status(400).json({
          error: 'Only pending or active info-requested claims can be rejected'
        });
      }

      // Close any active additional_info conversation
      db.prepare(`
        UPDATE conversations
        SET status = 'closed'
        WHERE claim_id = ?
          AND type = 'additional_info'
      `).run(req.params.id);

      // Notify claimant
      createNotification({
        user_id: claim.claimer_id,
        type: 'claim_rejected',
        title: 'Claim Rejected',
        message: `Your claim for "${item.title}" was rejected.`,
        item_id: item.id,
        claim_id: claim.id
      });

      res.json({
        message: 'Claim rejected'
      });
    } catch (err) {
      console.error('Reject claim error:', err);
      res.status(500).json({
        error: 'Failed to reject claim'
      });
    }
  }
);

/* =========================
   CONVERSATIONS API
========================= */

// Get all conversations for current user
app.get(
  '/api/conversations',
  authenticateToken,
  (req, res) => {
    try {
      const userId = req.user.userId;

      const rawConvs = db.prepare(`
        SELECT
          c.*,
          i.title AS item_title,
          i.category AS item_category,
          i.image_path AS item_image_path,
          i.location AS item_location,
          i.status AS item_status,
          cl.status AS claim_status
        FROM conversations c
        JOIN items i ON c.item_id = i.id
        JOIN claims cl ON c.claim_id = cl.id
        WHERE c.participant_one = ? OR c.participant_two = ?
        ORDER BY c.updated_at DESC
      `).all(userId, userId);

      const conversations = rawConvs.map((conv) => {
        const otherParticipant =
          conv.participant_one === userId
            ? conv.participant_two
            : conv.participant_one;

        // Get last message
        const lastMsg = db.prepare(`
          SELECT message, created_at, sender_id
          FROM messages
          WHERE conversation_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `).get(conv.id);

        // Get unread count for current user
        const unreadCount = db.prepare(`
          SELECT COUNT(*) as count
          FROM messages
          WHERE conversation_id = ?
            AND sender_id <> ?
            AND read_at IS NULL
        `).get(conv.id, userId).count;

        return {
          id: conv.id,
          item_id: conv.item_id,
          claim_id: conv.claim_id,
          type: conv.type,
          participant_one: conv.participant_one,
          participant_two: conv.participant_two,
          other_participant: otherParticipant,
          status: conv.status,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          item: {
            id: conv.item_id,
            title: conv.item_title,
            category: conv.item_category,
            image_path: conv.item_image_path,
            location: conv.item_location,
            status: conv.item_status,
            claim_status: conv.claim_status
          },
          last_message: lastMsg ? lastMsg.message : null,
          last_message_at: lastMsg ? lastMsg.created_at : conv.created_at,
          last_message_sender: lastMsg ? lastMsg.sender_id : null,
          unread_count: unreadCount
        };
      });

      res.json(conversations);
    } catch (err) {
      console.error('Fetch conversations error:', err);
      res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  }
);

// Get single conversation
app.get(
  '/api/conversations/:id',
  authenticateToken,
  (req, res) => {
    try {
      const userId = req.user.userId;

      const conv = db.prepare(`
        SELECT
          c.*,
          i.title AS item_title,
          i.category AS item_category,
          i.image_path AS item_image_path,
          i.location AS item_location,
          i.status AS item_status,
          cl.status AS claim_status
        FROM conversations c
        JOIN items i ON c.item_id = i.id
        JOIN claims cl ON c.claim_id = cl.id
        WHERE c.id = ?
      `).get(req.params.id);

      if (!conv) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (conv.participant_one !== userId && conv.participant_two !== userId) {
        return res.status(403).json({ error: 'Access denied to this conversation' });
      }

      const otherParticipant =
        conv.participant_one === userId
          ? conv.participant_two
          : conv.participant_one;

      res.json({
        id: conv.id,
        item_id: conv.item_id,
        claim_id: conv.claim_id,
        type: conv.type,
        participant_one: conv.participant_one,
        participant_two: conv.participant_two,
        other_participant: otherParticipant,
        status: conv.status,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        item: {
          id: conv.item_id,
          title: conv.item_title,
          category: conv.item_category,
          image_path: conv.item_image_path,
          location: conv.item_location,
          status: conv.item_status,
          claim_status: conv.claim_status
        }
      });
    } catch (err) {
      console.error('Fetch conversation error:', err);
      res.status(500).json({ error: 'Failed to fetch conversation' });
    }
  }
);

// Get messages for conversation
app.get(
  '/api/conversations/:id/messages',
  authenticateToken,
  (req, res) => {
    try {
      const userId = req.user.userId;

      const conv = db.prepare(`
        SELECT * FROM conversations WHERE id = ?
      `).get(req.params.id);

      if (!conv) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (conv.participant_one !== userId && conv.participant_two !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Mark unread messages as read for current user
      db.prepare(`
        UPDATE messages
        SET read_at = CURRENT_TIMESTAMP
        WHERE conversation_id = ?
          AND sender_id <> ?
          AND read_at IS NULL
      `).run(req.params.id, userId);

      const messages = db.prepare(`
        SELECT id, conversation_id, sender_id, message, created_at, read_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `).all(req.params.id);

      res.json(messages);
    } catch (err) {
      console.error('Fetch messages error:', err);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  }
);

// Send message in conversation
app.post(
  '/api/conversations/:id/messages',
  authenticateToken,
  (req, res) => {
    try {
      const userId = req.user.userId;
      const { message } = req.body;

      if (typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Message text is required' });
      }

      const cleanMsg = message.trim();

      if (cleanMsg.length > 2000) {
        return res.status(400).json({ error: 'Message must be 2000 characters or less' });
      }

      const conv = db.prepare(`
        SELECT c.*, i.title as item_title
        FROM conversations c
        JOIN items i ON c.item_id = i.id
        WHERE c.id = ?
      `).get(req.params.id);

      if (!conv) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (conv.participant_one !== userId && conv.participant_two !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const result = db.prepare(`
        INSERT INTO messages (conversation_id, sender_id, message)
        VALUES (?, ?, ?)
      `).run(req.params.id, userId, cleanMsg);

      // Update conversation updated_at
      db.prepare(`
        UPDATE conversations
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(req.params.id);

      // Notify the recipient
      const recipientId =
        conv.participant_one === userId
          ? conv.participant_two
          : conv.participant_one;

      const preview = cleanMsg.length > 50 ? cleanMsg.slice(0, 47) + '...' : cleanMsg;

      createNotification({
        user_id: recipientId,
        type: 'new_message',
        title: `New message regarding ${conv.item_title}`,
        message: `${userId}: ${preview}`,
        item_id: conv.item_id,
        claim_id: conv.claim_id,
        conversation_id: conv.id
      });

      const insertedMessage = db.prepare(`
        SELECT id, conversation_id, sender_id, message, created_at, read_at
        FROM messages
        WHERE id = ?
      `).get(result.lastInsertRowid);

      res.json(insertedMessage);
    } catch (err) {
      console.error('Send message error:', err);
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
);

/* =========================
   NOTIFICATIONS API
========================= */

// Get user notifications
app.get(
  '/api/notifications',
  authenticateToken,
  (req, res) => {
    try {
      const userId = req.user.userId;

      const notifications = db.prepare(`
        SELECT *
        FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 50
      `).all(userId);

      const unreadCount = db.prepare(`
        SELECT COUNT(*) as count
        FROM notifications
        WHERE user_id = ? AND is_read = 0
      `).get(userId).count;

      res.json({
        notifications,
        unreadCount
      });
    } catch (err) {
      console.error('Fetch notifications error:', err);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  }
);

// Mark single notification as read
app.patch(
  '/api/notifications/:id/read',
  authenticateToken,
  (req, res) => {
    try {
      const userId = req.user.userId;

      db.prepare(`
        UPDATE notifications
        SET is_read = 1
        WHERE id = ? AND user_id = ?
      `).run(req.params.id, userId);

      res.json({ message: 'Notification marked as read' });
    } catch (err) {
      console.error('Mark notification read error:', err);
      res.status(500).json({ error: 'Failed to update notification' });
    }
  }
);

// Mark all notifications as read
app.patch(
  '/api/notifications/read-all',
  authenticateToken,
  (req, res) => {
    try {
      const userId = req.user.userId;

      db.prepare(`
        UPDATE notifications
        SET is_read = 1
        WHERE user_id = ?
      `).run(userId);

      res.json({ message: 'All notifications marked as read' });
    } catch (err) {
      console.error('Mark all read error:', err);
      res.status(500).json({ error: 'Failed to update notifications' });
    }
  }
);

/* =========================
   STATS
========================= */

app.get(
  '/api/stats',
  (req, res) => {

    const reported =
      db.prepare(`
        SELECT COUNT(*) count
        FROM items
      `).get();

    const available =
      db.prepare(`
        SELECT COUNT(*) count
        FROM items
        WHERE status='found'
      `).get();

    const returned =
      db.prepare(`
        SELECT COUNT(*) count
        FROM items
        WHERE status='returned'
      `).get();

    const pendingClaims =
      db.prepare(`
        SELECT COUNT(*) count
        FROM claims
        WHERE status='pending'
      `).get();

    res.json({
      reported:
        reported.count,

      available:
        available.count,

      returned:
        returned.count,

      pendingClaims:
        pendingClaims.count
    });
  }
);

/* =========================
    ADMIN ROUTES
========================= */

app.get(
  '/api/admin/stats',
  authenticateToken,
  (req, res) => {

    const user = db.prepare(`
      SELECT *
      FROM users
      WHERE user_id = ?
    `).get(req.user.userId);

    if (
      !user ||
      user.role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }

    const totalUsers =
      db.prepare(`
        SELECT COUNT(*) as count
        FROM users
      `).get().count;

    const totalItems =
      db.prepare(`
        SELECT COUNT(*) as count
        FROM items
      `).get().count;

    const pendingClaims =
      db.prepare(`
        SELECT COUNT(*) as count
        FROM claims
        WHERE status='pending'
      `).get().count;

    const returnedItems =
      db.prepare(`
        SELECT COUNT(*) as count
        FROM items
        WHERE status='returned'
      `).get().count;

    res.json({
      totalUsers,
      totalItems,
      pendingClaims,
      returnedItems
    });

  }
);

/* =========================
   ADMIN - ALL USERS
========================= */

app.get(
  '/api/admin/users',
  authenticateToken,
  (req, res) => {

    const user = db.prepare(`
      SELECT *
      FROM users
      WHERE user_id = ?
    `).get(req.user.userId);

    if (
      !user ||
      user.role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }

    const users = db.prepare(`
      SELECT
        id,
        user_id,
        role,
        created_at
      FROM users
      ORDER BY created_at DESC
    `).all();

    res.json(users);

  }
);

/* =========================
   ADMIN - ALL ITEMS
========================= */

app.get(
  '/api/admin/items',
  authenticateToken,
  (req, res) => {

    const user = db.prepare(`
      SELECT *
      FROM users
      WHERE user_id = ?
    `).get(req.user.userId);

    if (
      !user ||
      user.role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }

    const items = db.prepare(`
      SELECT *
      FROM items
      ORDER BY created_at DESC
    `).all();

    res.json(items);

  }
);

/* =========================
   ADMIN - ALL CLAIMS
========================= */

app.get(
  '/api/admin/claims',
  authenticateToken,
  (req, res) => {

    const user = db.prepare(`
      SELECT *
      FROM users
      WHERE user_id = ?
    `).get(req.user.userId);

    if (
      !user ||
      user.role !== 'admin'
    ) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }

    const claims = db.prepare(`
      SELECT
        claims.*,
        items.title
      FROM claims
      JOIN items
      ON claims.item_id = items.id
      ORDER BY claims.created_at DESC
    `).all();

    res.json(claims);

  }
);


/* =========================
   ADMIN - DELETE USER
========================= */

app.delete(
  '/api/admin/users/:id',
  authenticateToken,
  (req, res) => {

    try {

      // Check that requester is an admin
      const admin = db.prepare(`
        SELECT *
        FROM users
        WHERE user_id = ?
      `).get(req.user.userId);

      if (
        !admin ||
        admin.role !== 'admin'
      ) {
        return res.status(403).json({
          error: 'Access denied'
        });
      }

      const userId = Number(req.params.id);

      if (!Number.isInteger(userId)) {
        return res.status(400).json({
          error: 'Invalid user ID'
        });
      }

      // Find target user
      const targetUser = db.prepare(`
        SELECT *
        FROM users
        WHERE id = ?
      `).get(userId);

      if (!targetUser) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      // Never allow an admin to delete another admin
      if (targetUser.role === 'admin') {
        return res.status(400).json({
          error: 'Cannot delete admin'
        });
      }

      /*
        Anonymize the user's existing activity
        instead of deleting it.
      */

      const deleteUser = db.transaction(() => {
        // Preserve reported items
        db.prepare(`
          UPDATE items
          SET finder_id = '[deleted-user]'
          WHERE finder_id = ?
        `).run(targetUser.user_id);

        // Preserve claims
        db.prepare(`
          UPDATE claims
          SET claimer_id = '[deleted-user]'
          WHERE claimer_id = ?
        `).run(targetUser.user_id);

        // Anonymize conversation participants
        db.prepare(`
          UPDATE conversations
          SET participant_one = '[deleted-user]'
          WHERE participant_one = ?
        `).run(targetUser.user_id);

        db.prepare(`
          UPDATE conversations
          SET participant_two = '[deleted-user]'
          WHERE participant_two = ?
        `).run(targetUser.user_id);

        // Delete notifications for deleted user
        db.prepare(`
          DELETE FROM notifications
          WHERE user_id = ?
        `).run(targetUser.user_id);

        // Delete the actual account
        db.prepare(`
          DELETE FROM users
          WHERE id = ?
        `).run(userId);
      });

      deleteUser();

      res.json({
        message:
          'User deleted and associated activity anonymized'
      });

    } catch (err) {

      console.error(
        'Delete user error:',
        err
      );

      res.status(500).json({
        error: 'Failed to delete user'
      });
    }
  }
);


/* =========================
   ADMIN - DELETE ITEM
========================= */

app.delete(
  '/api/admin/items/:id',
  authenticateToken,
  (req, res) => {

    try {

      // Check that the requester is an admin
      const admin = db.prepare(`
        SELECT *
        FROM users
        WHERE user_id = ?
      `).get(req.user.userId);

      if (
        !admin ||
        admin.role !== 'admin'
      ) {
        return res.status(403).json({
          error: 'Access denied'
        });
      }

      const itemId = Number(req.params.id);

      if (!Number.isInteger(itemId)) {
        return res.status(400).json({
          error: 'Invalid item ID'
        });
      }

      // Check that the item exists
      const item = db.prepare(`
        SELECT *
        FROM items
        WHERE id = ?
      `).get(itemId);

      if (!item) {
        return res.status(404).json({
          error: 'Item not found'
        });
      }

      /*
        Delete everything related to the item
        before deleting the item itself.
      */

      const deleteItem = db.transaction(() => {
        // Delete messages associated with conversations for this item
        db.prepare(`
          DELETE FROM messages
          WHERE conversation_id IN (
            SELECT id FROM conversations WHERE item_id = ?
          )
        `).run(itemId);

        // Delete notifications associated with this item or its conversations
        db.prepare(`
          DELETE FROM notifications
          WHERE item_id = ?
            OR conversation_id IN (
              SELECT id FROM conversations WHERE item_id = ?
            )
        `).run(itemId, itemId);

        // Delete conversations for this item
        db.prepare(`
          DELETE FROM conversations
          WHERE item_id = ?
        `).run(itemId);

        // Delete contact details belonging to claims for this item
        db.prepare(`
          DELETE FROM claim_contacts
          WHERE claim_id IN (
            SELECT id
            FROM claims
            WHERE item_id = ?
          )
        `).run(itemId);

        // Delete all claims belonging to this item
        db.prepare(`
          DELETE FROM claims
          WHERE item_id = ?
        `).run(itemId);

        // Delete the item
        db.prepare(`
          DELETE FROM items
          WHERE id = ?
        `).run(itemId);
      });

      deleteItem();

      /*
        Remove the uploaded image from disk
        after the database deletion succeeds.
      */

      if (item.image_path) {

        const imagePath =
          path.join(
            __dirname,
            item.image_path.replace(
              /^\/uploads[\\/]/,
              'uploads/'
            )
          );

        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      }

      res.json({
        message: 'Item deleted successfully'
      });

    } catch (err) {

      console.error(
        'Delete item error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to delete item'
      });

    }
  }
);

/* =========================
   GLOBAL ERROR HANDLER
========================= */

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'Image must be 5 MB or smaller'
      });
    }

    return res.status(400).json({
      error: 'Image upload failed'
    });
  }

  if (err) {
    return res.status(400).json({
      error: err.message || 'Request failed'
    });
  }

  next();
});

/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  () => {
    console.log(
      `🚀 Campus Lost & Found Backend V3 running on port ${PORT}`
    );
  }
);