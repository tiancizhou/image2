const express = require('express');
const auth = require('../middleware/auth');
const lottery = require('../services/lottery');

const router = express.Router();

router.get('/me', auth, async (req, res, next) => {
  try {
    res.json(await lottery.getMe(req.userId));
  } catch (err) {
    next(err);
  }
});

router.post('/claim-rules', auth, async (req, res, next) => {
  try {
    res.json(await lottery.claimRules(req.userId));
  } catch (err) {
    next(err);
  }
});

router.post('/draw', auth, async (req, res, next) => {
  try {
    res.json(await lottery.draw(req.userId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
