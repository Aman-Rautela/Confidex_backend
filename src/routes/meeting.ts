// src/routes/meeting.ts
import express, { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { createMeetingValidation, validateRequest } from '../middleware/validator';
import { generalLimiter } from '../middleware/rateLimiter';

const router = express.Router();

// Create Meeting
router.post(
  '/create',
  authenticateToken,
  generalLimiter,
  createMeetingValidation,
  validateRequest,
  async (req: AuthRequest, res: Response) => {
    try {
      const { title } = req.body;
      const meetingId = uuidv4();
      const maxParticipantsEnv = process.env.MAX_PARTICIPANTS || '10';
      const maxParticipants = parseInt(maxParticipantsEnv, 10);

      const result = await query(
        'INSERT INTO meetings (id, host_id, title, max_participants) VALUES ($1, $2, $3, $4) RETURNING *',
        [meetingId, req.userId, title, maxParticipants]
      );

      const meeting = result.rows[0];

      res.status(201).json({
        meeting: {
          id: meeting.id,
          title: meeting.title,
          joinUrl: `${process.env.FRONTEND_URL}/meeting/${meeting.id}`,
          code: meeting.id.split('-')[0].toUpperCase(),
          maxParticipants: meeting.max_participants,
          createdAt: meeting.created_at,
        },
      });
    } catch (error) {
      console.error('Create meeting error:', error);
      res.status(500).json({ error: 'Failed to create meeting' });
    }
  }
);

// Get Meeting Details
router.get('/details/:meetingId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { meetingId } = req.params;

    const result = await query(
      `SELECT m.*, u.name as host_name, u.email as host_email,
       (SELECT COUNT(*) FROM meeting_participants WHERE meeting_id = m.id AND left_at IS NULL) as current_participants
       FROM meetings m
       JOIN users u ON m.host_id = u.id
       WHERE m.id = $1`,
      [meetingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const meeting = result.rows[0];

    if (meeting.status === 'ended') {
      return res.status(400).json({ error: 'Meeting has ended' });
    }

    res.json({
      meeting: {
        id: meeting.id,
        title: meeting.title,
        hostName: meeting.host_name,
        isHost: meeting.host_id === req.userId,
        currentParticipants: parseInt(meeting.current_participants),
        maxParticipants: meeting.max_participants,
        status: meeting.status,
        createdAt: meeting.created_at,
      },
    });
  } catch (error) {
    console.error('Get meeting error:', error);
    res.status(500).json({ error: 'Failed to get meeting details' });
  }
});

// Join Meeting (Validate)
router.post('/join/:meetingId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { meetingId } = req.params;

    const result = await query(
      `SELECT m.*, 
       (SELECT COUNT(*) FROM meeting_participants WHERE meeting_id = m.id AND left_at IS NULL) as current_participants
       FROM meetings m
       WHERE m.id = $1`,
      [meetingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const meeting = result.rows[0];

    if (meeting.status === 'ended') {
      return res.status(400).json({ error: 'Meeting has ended' });
    }

    const currentParticipants = parseInt(meeting.current_participants);
    if (currentParticipants >= meeting.max_participants) {
      return res.status(400).json({ error: 'Meeting is full' });
    }

    // Add participant record (will be updated with socket_id when they actually connect)
    await query(
      'INSERT INTO meeting_participants (meeting_id, user_id) VALUES ($1, $2) ON CONFLICT (meeting_id, user_id) DO NOTHING',
      [meetingId, req.userId]
    );

    res.json({
      message: 'Authorized to join meeting',
      meeting: {
        id: meeting.id,
        title: meeting.title,
        isHost: meeting.host_id === req.userId,
      },
    });
  } catch (error) {
    console.error('Join meeting error:', error);
    res.status(500).json({ error: 'Failed to join meeting' });
  }
});

// End Meeting (Host only)
router.post('/end/:meetingId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { meetingId } = req.params;

    const result = await query('SELECT host_id FROM meetings WHERE id = $1', [meetingId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (result.rows[0].host_id !== req.userId) {
      return res.status(403).json({ error: 'Only host can end the meeting' });
    }

    await query('UPDATE meetings SET status = $1, ended_at = NOW() WHERE id = $2', [
      'ended',
      meetingId,
    ]);
    await query('UPDATE meeting_participants SET left_at = NOW() WHERE meeting_id = $1 AND left_at IS NULL', [
      meetingId,
    ]);

    res.json({ message: 'Meeting ended successfully' });
  } catch (error) {
    console.error('End meeting error:', error);
    res.status(500).json({ error: 'Failed to end meeting' });
  }
});

// Get My Meetings
router.get('/my-meetings', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT m.*, 
       (SELECT COUNT(*) FROM meeting_participants WHERE meeting_id = m.id) as total_participants
       FROM meetings m
       WHERE m.host_id = $1
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [req.userId]
    );

    res.json({
      meetings: result.rows.map((m) => ({
        id: m.id,
        title: m.title,
        status: m.status,
        participants: m.total_participants,
        createdAt: m.created_at,
        endedAt: m.ended_at,
      })),
    });
  } catch (error) {
    console.error('Get my meetings error:', error);
    res.status(500).json({ error: 'Failed to get meetings' });
  }
});

// Kick Participant (Host only)
router.post('/kick/:meetingId/:userId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { meetingId, userId } = req.params;

    const result = await query('SELECT host_id FROM meetings WHERE id = $1', [meetingId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (result.rows[0].host_id !== req.userId) {
      return res.status(403).json({ error: 'Only host can kick participants' });
    }

    await query('UPDATE meeting_participants SET left_at = NOW() WHERE meeting_id = $1 AND user_id = $2', [
      meetingId,
      userId,
    ]);

    res.json({ message: 'Participant kicked successfully' });
  } catch (error) {
    console.error('Kick participant error:', error);
    res.status(500).json({ error: 'Failed to kick participant' });
  }
});

export default router;