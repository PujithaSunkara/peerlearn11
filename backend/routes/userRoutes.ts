import { Router, Response } from 'express';
import { User, ICompetencyItem } from '../models/User.js';
import { Competency } from '../models/Competency.js';
import { DoubtRequest } from '../models/DoubtRequest.js';
import { LearningRequest } from '../models/LearningRequest.js';
import { LearningSession } from '../models/LearningSession.js';
import { AssessmentTask } from '../models/AssessmentTask.js';
import { AssessmentAttempt } from '../models/AssessmentAttempt.js';
import { protect, AuthRequest } from '../middleware/auth.js';
import {
  generateCustomSkillAssessmentWithGemini,
  generateRoleRoadmapWithGemini,
} from '../services/geminiService.js';

const router = Router();

function inferCategoryForSkill(
  skill: string
): 'Programming' | 'Debugging' | 'Problem-solving' | 'Data analysis' | 'Communication' {
  const s = skill.toLowerCase();
  if (s.includes('debug') || s.includes('test')) return 'Debugging';
  if (s.includes('dsa') || s.includes('algorithm') || s.includes('problem')) return 'Problem-solving';
  if (s.includes('sql') || s.includes('data') || s.includes('pandas') || s.includes('ml'))
    return 'Data analysis';
  if (s.includes('comm') || s.includes('english')) return 'Communication';
  return 'Programming';
}

// POST /api/users/onboarding-details
// Saves Student Details (College, Branch, Year, Skills known, Fixed Target Role) during initial onboarding
// and dynamically generates the Skill Assessment Test based on those exact skills!
router.post('/onboarding-details', protect, async (req: AuthRequest, res: Response) => {
  try {
    const {
      college,
      branch,
      year,
      skills,
      targetCareerRole,
      bio,
      availabilityStatus,
    } = req.body;

    const parsedSkills: string[] = Array.isArray(skills)
      ? skills.map((s) => String(s).trim()).filter(Boolean)
      : String(skills || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

    if (parsedSkills.length === 0) {
      res.status(400).json({
        message: 'Please enter at least one skill you know so we can generate your assessment test.',
      });
      return;
    }

    const user = await User.findById(req.user!._id);
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    // If user is already past initial onboarding, preserve existing college, branch, year, and fixed role
    const isInitialOnboarding = user.onboardingStep === 'details';

    const cleanCollege =
      isInitialOnboarding && college && String(college).trim()
        ? String(college).trim()
        : user.academicDetails?.institution || "Vignan's Institute of Information Technology";
    const cleanBranch =
      isInitialOnboarding && branch && String(branch).trim()
        ? String(branch).trim()
        : user.academicDetails?.major || 'Computer Science & Engineering (CSE)';
    const cleanYear =
      isInitialOnboarding && year && String(year).trim()
        ? String(year).trim()
        : user.academicDetails?.yearOfStudy || '3rd Year';
    const cleanRole =
      isInitialOnboarding && targetCareerRole && String(targetCareerRole).trim()
        ? String(targetCareerRole).trim()
        : user.targetCareerRole || 'Full Stack Developer';

    user.academicDetails = {
      institution: cleanCollege,
      major: cleanBranch,
      yearOfStudy: cleanYear,
    };
    user.targetCareerRole = cleanRole;
    user.bio =
      bio && String(bio).trim()
        ? String(bio).trim()
        : `${cleanYear} ${cleanBranch} student at ${cleanCollege} preparing for ${cleanRole}. Skilled in ${parsedSkills.join(', ')}.`;

    user.availability = {
      status:
        availabilityStatus === 'Busy' || availabilityStatus === 'Offline'
          ? availabilityStatus
          : user.availability?.status || 'Available',
      preferredHours: 'Available Now',
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    };

    // Merge new skills while preserving verification evidence of previously verified skills
    const existingMap = new Map<string, ICompetencyItem>();
    for (const c of user.competencies || []) {
      existingMap.set(c.skillName.toLowerCase(), c);
    }

    for (const skillName of parsedSkills) {
      const key = skillName.toLowerCase();
      if (!existingMap.has(key)) {
        existingMap.set(key, {
          category: inferCategoryForSkill(skillName),
          skillName,
          proficiencyLevel: 'Intermediate',
          isVerified: false,
          updatedAt: new Date(),
        });
      }
    }

    user.competencies = Array.from(existingMap.values());
    if (isInitialOnboarding) {
      user.onboardingStep = 'assessment';
    }
    await user.save();

    // Generate custom assessment task tailored to the student's mentioned skills
    const customQuestions = await generateCustomSkillAssessmentWithGemini(
      parsedSkills,
      cleanRole
    );

    const slug = `onboarding-skill-test-${user._id.toString()}-${Date.now()}`;
    const customTask = await AssessmentTask.create({
      title: `Skill Verification Test: ${parsedSkills.slice(0, 3).join(', ')}`,
      slug,
      competencyCategory: 'Programming',
      skillName: parsedSkills.join(', '),
      difficulty: 'Intermediate',
      durationMinutes: 15,
      description: `Personalized skill assessment generated from your selected skills (${parsedSkills.join(
        ', '
      )}) for your fixed role as ${cleanRole}.`,
      maxScore: 100,
      passingScorePercent: 60,
      rubric: [
        {
          criterion: 'Technical Accuracy',
          weightPercent: 70,
          description: 'Correctness on questions covering your stated skills.',
        },
        {
          criterion: 'Role Readiness',
          weightPercent: 30,
          description: `Practical engineering application for ${cleanRole}.`,
        },
      ],
      questions: customQuestions,
    });

    const updatedUser = await User.findById(user._id).select('-passwordHash');
    res.json({
      user: updatedUser,
      assessmentTaskId: customTask._id,
      message: 'Skills saved! Proceeding to your personalized skill assessment test.',
    });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// POST /api/users/reassessment — Ask only what skills the student wants to be assessed on (adds new skills to profile if not present) and start the assessment without asking college, branch, year, or role again!
router.post('/reassessment', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { skills } = req.body;
    const parsedSkills: string[] = Array.isArray(skills)
      ? skills.map((s) => String(s).trim()).filter(Boolean)
      : String(skills || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

    if (parsedSkills.length === 0) {
      res.status(400).json({
        message: 'Please select or enter at least one skill you want to be assessed on.',
      });
      return;
    }

    const user = await User.findById(req.user!._id);
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    // Add any newly entered skills to user's competencies while preserving existing ones
    const existingMap = new Map<string, ICompetencyItem>();
    for (const c of user.competencies || []) {
      existingMap.set(c.skillName.toLowerCase(), c);
    }

    for (const skillName of parsedSkills) {
      const key = skillName.toLowerCase();
      if (!existingMap.has(key)) {
        existingMap.set(key, {
          category: inferCategoryForSkill(skillName),
          skillName,
          proficiencyLevel: 'Intermediate',
          isVerified: false,
          updatedAt: new Date(),
        });
      }
    }

    user.competencies = Array.from(existingMap.values());
    await user.save();

    const fixedRole = user.targetCareerRole || 'Full Stack Developer';
    const customQuestions = await generateCustomSkillAssessmentWithGemini(
      parsedSkills,
      fixedRole
    );

    const slug = `skill-reassessment-${user._id.toString()}-${Date.now()}`;
    const customTask = await AssessmentTask.create({
      title: `Skill Assessment: ${parsedSkills.slice(0, 3).join(', ')}`,
      slug,
      competencyCategory: 'Programming',
      skillName: parsedSkills.join(', '),
      difficulty: 'Intermediate',
      durationMinutes: 15,
      description: `Focused skill assessment on ${parsedSkills.join(', ')}.`,
      maxScore: 100,
      passingScorePercent: 60,
      rubric: [
        {
          criterion: 'Skill Mastery',
          weightPercent: 75,
          description: `Technical accuracy across ${parsedSkills.join(', ')}.`,
        },
        {
          criterion: 'Problem Solving',
          weightPercent: 25,
          description: 'Applied implementation and debugging accuracy.',
        },
      ],
      questions: customQuestions,
    });

    const updatedUser = await User.findById(user._id).select('-passwordHash');
    res.status(201).json({
      user: updatedUser,
      assessmentTaskId: customTask._id,
      task: customTask,
    });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// POST /api/users/complete-onboarding — Mark onboarding completed
router.post('/complete-onboarding', protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user!._id,
      { onboardingStep: 'completed' },
      { new: true }
    ).select('-passwordHash');
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// GET /api/users/role-dashboard — Get learning roadmap, readiness stats, and role assessments for the student's FIXED career role
router.get('/role-dashboard', protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user!._id).select('-passwordHash');
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    const attempts = await AssessmentAttempt.find({ user: user._id }).sort({
      completedAt: -1,
    });

    const roadmap = await generateRoleRoadmapWithGemini(
      user.targetCareerRole || 'Full Stack Developer',
      (user.competencies || []).map((c: ICompetencyItem) => ({
        skillName: c.skillName,
        isVerified: c.isVerified,
        verifiedScore: c.verifiedScore,
      }))
    );

    res.json({
      user,
      roadmap,
      attempts,
    });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// POST /api/users/role-assessment — Generate a new assessment specifically for preparing for the student's fixed target role
router.post('/role-assessment', protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user!._id);
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    const { customTopic } = req.body;
    const roleName = user.targetCareerRole || 'Full Stack Developer';
    const userSkillList = (user.competencies || []).map(
      (c: ICompetencyItem) => c.skillName
    );
    const focusSkills =
      customTopic && String(customTopic).trim()
        ? [String(customTopic).trim(), ...userSkillList.slice(0, 3)]
        : userSkillList.length > 0
        ? userSkillList
        : [roleName];

    const questions = await generateCustomSkillAssessmentWithGemini(
      focusSkills,
      roleName
    );

    const task = await AssessmentTask.create({
      title: `${roleName} Role Readiness Assessment`,
      slug: `role-prep-${user._id.toString()}-${Date.now()}`,
      competencyCategory: 'Programming',
      skillName: focusSkills.join(', '),
      difficulty: 'Intermediate',
      durationMinutes: 15,
      description: `Targeted role preparation assessment for your fixed role (${roleName}).`,
      maxScore: 100,
      passingScorePercent: 60,
      rubric: [
        {
          criterion: 'Role Competency',
          weightPercent: 70,
          description: `Mastery of ${roleName} core competencies.`,
        },
        {
          criterion: 'Problem Solving',
          weightPercent: 30,
          description: 'Applied scenario evaluation.',
        },
      ],
      questions,
    });

    res.status(201).json({ taskId: task._id, task });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// GET /api/users/dashboard-stats
router.get('/dashboard-stats', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!._id;

    const [
      doubtsCount,
      pendingIncomingRequests,
      activeSessions,
      recentAttempts,
      allPeersCount,
    ] = await Promise.all([
      DoubtRequest.countDocuments({ student: userId }),
      LearningRequest.countDocuments({ mentor: userId, status: 'Pending' }),
      LearningSession.find({
        $or: [{ learner: userId }, { mentor: userId }],
        status: 'Active',
      })
        .populate('learner', 'name username email academicDetails avatarUrl targetCareerRole')
        .populate('mentor', 'name username email academicDetails avatarUrl targetCareerRole')
        .sort({ updatedAt: -1 })
        .limit(5),
      AssessmentAttempt.find({ user: userId }).sort({ completedAt: -1 }).limit(10),
      User.countDocuments({ _id: { $ne: userId } }),
    ]);

    const verifiedCompetenciesCount = (req.user!.competencies || []).filter(
      (c: ICompetencyItem) => c.isVerified
    ).length;
    const selfReportedCount = (req.user!.competencies || []).filter(
      (c: ICompetencyItem) => !c.isVerified
    ).length;

    res.json({
      doubtsCount,
      pendingIncomingRequests,
      activeSessions,
      recentAttempts,
      allPeersCount,
      verifiedCompetenciesCount,
      selfReportedCount,
    });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// GET /api/users/competency-catalog
router.get('/competency-catalog', protect, async (_req: AuthRequest, res: Response) => {
  try {
    const catalog = await Competency.find().sort({ category: 1, name: 1 });
    res.json({ catalog });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// PUT /api/users/profile — Role is fixed during creation so targetCareerRole is not overwritten
router.put('/profile', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { name, bio, academicDetails, availability } = req.body;
    const user = await User.findById(req.user!._id);
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    if (name && String(name).trim().length >= 2) {
      user.name = String(name).trim();
    }
    if (typeof bio === 'string') {
      user.bio = bio.trim();
    }
    if (academicDetails) {
      user.academicDetails = {
        institution: academicDetails.institution || user.academicDetails.institution,
        major: academicDetails.major || user.academicDetails.major,
        yearOfStudy: academicDetails.yearOfStudy || user.academicDetails.yearOfStudy,
      };
    }
    if (availability) {
      const validStatuses = ['Available', 'Busy', 'Offline'] as const;
      user.availability = {
        status: validStatuses.includes(availability.status)
          ? availability.status
          : user.availability.status,
        preferredHours: availability.preferredHours ?? user.availability.preferredHours,
        days: Array.isArray(availability.days) ? availability.days : user.availability.days,
      };
    }

    await user.save();
    const updated = await User.findById(user._id).select('-passwordHash');
    res.json({ user: updated, message: 'Profile updated successfully.' });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// POST /api/users/competencies — Add a new skill to the student's profile
router.post('/competencies', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { category, skillName, proficiencyLevel } = req.body;
    const validCategories = [
      'Programming',
      'Debugging',
      'Problem-solving',
      'Data analysis',
      'Communication',
    ] as const;
    const validLevels = ['Beginner', 'Intermediate', 'Advanced'] as const;

    const cleanCategory = validCategories.includes(category)
      ? category
      : inferCategoryForSkill(String(skillName || ''));
    if (!skillName || String(skillName).trim().length < 1) {
      res.status(400).json({ message: 'Skill name is required.' });
      return;
    }
    const cleanLevel = validLevels.includes(proficiencyLevel)
      ? proficiencyLevel
      : 'Intermediate';

    const cleanSkill = String(skillName).trim();
    const user = await User.findById(req.user!._id);
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    const existingIdx = user.competencies.findIndex(
      (c: ICompetencyItem) => c.skillName.toLowerCase() === cleanSkill.toLowerCase()
    );

    if (existingIdx >= 0) {
      user.competencies[existingIdx].category = cleanCategory;
      user.competencies[existingIdx].proficiencyLevel = cleanLevel;
      user.competencies[existingIdx].updatedAt = new Date();
    } else {
      user.competencies.push({
        category: cleanCategory,
        skillName: cleanSkill,
        proficiencyLevel: cleanLevel,
        isVerified: false,
        updatedAt: new Date(),
      });
    }

    await user.save();
    const updated = await User.findById(user._id).select('-passwordHash');
    res.json({
      user: updated,
      message: `Added "${cleanSkill}" to your skills profile.`,
    });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// DELETE /api/users/competencies/:skillName
router.delete('/competencies/:skillName', protect, async (req: AuthRequest, res: Response) => {
  try {
    const targetSkill = decodeURIComponent(req.params.skillName).toLowerCase();
    const user = await User.findById(req.user!._id);
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    user.competencies = user.competencies.filter(
      (c: ICompetencyItem) => c.skillName.toLowerCase() !== targetSkill
    );
    await user.save();

    const updated = await User.findById(user._id).select('-passwordHash');
    res.json({ user: updated, message: 'Skill removed from profile.' });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

// GET /api/users/peers
router.get('/peers', protect, async (req: AuthRequest, res: Response) => {
  try {
    const peers = await User.find({ _id: { $ne: req.user!._id } })
      .select('-passwordHash')
      .sort({ 'availability.status': 1, 'stats.averageRating': -1 });
    res.json({ peers });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

export default router;
