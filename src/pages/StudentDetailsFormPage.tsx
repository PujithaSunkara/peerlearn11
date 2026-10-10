import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GraduationCap,
  ArrowRight,
  Plus,
  X,
  AlertCircle,
  CheckCircle2,
  Target,
  Code2,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

// Strictly Career Roles (Fixed when the student creates their account)
const CAREER_ROLES = [
  'Full Stack Developer',
  'Python Developer',
  'AI / ML Engineer',
  'Frontend Developer',
  'Backend Engineer',
  'Data Scientist',
  'Software Development Engineer (SDE)',
  'DevOps & Cloud Engineer',
];

// Strictly Technical & Programming Skills (Can be added anytime and tested)
const TECHNICAL_SKILLS = [
  'C',
  'C++',
  'Python',
  'Java',
  'HTML',
  'CSS',
  'JavaScript',
  'React',
  'Node.js',
  'SQL',
  'Data Structures & Algorithms',
  'Machine Learning',
];

export function StudentDetailsFormPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  // If the student has already completed initial onboarding, DO NOT ask for College, Branch, Year, or Role again!
  // Only ask what skills they want to be assessed on.
  const isReassessmentMode =
    user?.onboardingStep === 'completed' || user?.onboardingStep === 'assessment';

  const [college, setCollege] = useState(
    user?.academicDetails?.institution ||
      "Vignan's Institute of Information Technology"
  );
  const [branch, setBranch] = useState(
    user?.academicDetails?.major || 'Computer Science & Engineering (CSE)'
  );
  const [year, setYear] = useState(
    user?.academicDetails?.yearOfStudy || '3rd Year'
  );
  const [targetCareerRole, setTargetCareerRole] = useState(
    user?.targetCareerRole || 'Full Stack Developer'
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    user?.competencies && user.competencies.length > 0
      ? user.competencies.map((c) => c.skillName)
      : ['C', 'Python', 'HTML', 'CSS']
  );
  const [customSkillInput, setCustomSkillInput] = useState('');
  const [availabilityStatus, setAvailabilityStatus] = useState<
    'Available' | 'Busy'
  >('Available');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const toggleSkill = (skill: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]
    );
  };

  const handleAddCustomSkill = () => {
    const trimmed = customSkillInput.trim();
    if (!trimmed) return;
    if (!selectedSkills.includes(trimmed)) {
      setSelectedSkills((prev) => [...prev, trimmed]);
    }
    setCustomSkillInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (selectedSkills.length === 0) {
      setError(
        'Please select or add at least one skill you want to be assessed on.'
      );
      return;
    }

    setSubmitting(true);
    try {
      if (isReassessmentMode) {
        const res = await api.post('/users/reassessment', {
          skills: selectedSkills,
        });
        await refreshUser();
        const taskId = res.data.assessmentTaskId;
        navigate(`/assessments/${taskId}/take`);
      } else {
        const res = await api.post('/users/onboarding-details', {
          college,
          branch,
          year,
          skills: selectedSkills,
          targetCareerRole,
          availabilityStatus,
        });
        await refreshUser();
        const taskId = res.data.assessmentTaskId;
        navigate(`/assessments/${taskId}/take?onboarding=true`);
      }
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || 'Could not start skill assessment. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 text-xl font-bold text-blue-700 font-display">
            <GraduationCap className="w-6 h-6 text-blue-600" />
            PeerConnect AI
          </div>
          <h1 className="text-2xl font-bold text-slate-900 font-display">
            {isReassessmentMode
              ? 'Skill Reassessment — Select Skills to Test'
              : 'Step 2: Student Details, Fixed Role & Skills Form'}
          </h1>
          <p className="text-sm text-slate-600">
            {isReassessmentMode
              ? 'Choose or add the specific skills you want to be assessed on right now. Your college, branch, year, and fixed career role are already saved.'
              : 'Provide your college, branch, year, fixed career role, and the skills you know. Next, you will take a Skill Assessment Test based on your selected skills.'}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 space-y-6"
        >
          {error && (
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Only ask College, Branch, Year, and Fixed Career Role during initial account creation */}
          {!isReassessmentMode && (
            <>
              <div>
                <label
                  htmlFor="onb-college"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  College / Institution Name
                </label>
                <input
                  id="onb-college"
                  type="text"
                  required
                  value={college}
                  onChange={(e) => setCollege(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="onb-branch"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Branch / Department
                  </label>
                  <select
                    id="onb-branch"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:border-blue-600 focus:outline-none bg-white"
                  >
                    <option value="Computer Science & Engineering (CSE)">
                      Computer Science & Engineering (CSE)
                    </option>
                    <option value="CSE (Artificial Intelligence & Data Science)">
                      CSE (Artificial Intelligence & Data Science)
                    </option>
                    <option value="Information Technology (IT)">
                      Information Technology (IT)
                    </option>
                    <option value="Electronics & Communication Engineering (ECE)">
                      Electronics & Communication Engineering (ECE)
                    </option>
                    <option value="Electrical & Electronics Engineering (EEE)">
                      Electrical & Electronics Engineering (EEE)
                    </option>
                    <option value="Mechanical Engineering">
                      Mechanical Engineering
                    </option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="onb-year"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Year of Study
                  </label>
                  <select
                    id="onb-year"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:border-blue-600 focus:outline-none bg-white"
                  >
                    <option value="1st Year">1st Year</option>
                    <option value="2nd Year">2nd Year</option>
                    <option value="3rd Year">3rd Year</option>
                    <option value="4th Year">4th Year</option>
                  </select>
                </div>
              </div>

              {/* Separate Fixed Career Role Section */}
              <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-200 space-y-3">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-indigo-600 shrink-0" />
                  <label
                    htmlFor="onb-role"
                    className="block text-xs font-bold text-indigo-950"
                  >
                    1. Your Career Role (Fixed Upon Creation — Tracked in Role Dashboard)
                  </label>
                </div>
                <p className="text-xs text-slate-600">
                  Select your target career track (e.g., Full Stack Developer, Python Developer, AI / ML Engineer). This role is fixed for your Role Dashboard.
                </p>
                <select
                  id="onb-role"
                  value={targetCareerRole}
                  onChange={(e) => setTargetCareerRole(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm font-semibold rounded-lg border border-indigo-300 bg-white text-slate-900 focus:border-indigo-600 focus:outline-none"
                >
                  {CAREER_ROLES.map((roleOption) => (
                    <option key={roleOption} value={roleOption}>
                      {roleOption}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Separate Technical Skills Section (Can be added & tested anytime) */}
          <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-200 space-y-3">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-blue-600 shrink-0" />
              <label className="block text-xs font-bold text-slate-900">
                {isReassessmentMode
                  ? 'What Skills Do You Want to Be Assessed On?'
                  : '2. Technical Skills You Know (e.g., C, Python, HTML, CSS — Can Add More Anytime)'}
              </label>
            </div>
            <p className="text-xs text-slate-600">
              Select or add technical skills (languages, tools, and role-related skills). Your assessment questions will be generated directly from these skills.
            </p>

            <div className="flex flex-wrap gap-2">
              {TECHNICAL_SKILLS.map((skill) => {
                const active = selectedSkills.includes(skill);
                return (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => toggleSkill(skill)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {active && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {skill}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={customSkillInput}
                onChange={(e) => setCustomSkillInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomSkill();
                  }
                }}
                placeholder="Add another skill (e.g., Django, TypeScript, Docker, Pandas)..."
                className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:border-blue-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCustomSkill}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Skill
              </button>
            </div>

            {selectedSkills.length > 0 && (
              <div className="p-3 rounded-lg bg-white border border-slate-200 space-y-1.5">
                <p className="text-xs font-semibold text-slate-700">
                  Skills Selected for Assessment ({selectedSkills.length}):
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedSkills.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-800 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => toggleSkill(s)}
                        className="text-blue-600 hover:text-blue-900 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {!isReassessmentMode && (
            <div>
              <label
                htmlFor="onb-avail"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Current Availability for Peer Matching
              </label>
              <select
                id="onb-avail"
                value={availabilityStatus}
                onChange={(e) =>
                  setAvailabilityStatus(e.target.value as 'Available' | 'Busy')
                }
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                <option value="Available">
                  Available Right Now (Visible to AI Agent for Live Peer Matching)
                </option>
                <option value="Busy">Busy</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            {submitting
              ? 'Generating Your Personalized Skill Assessment Test...'
              : isReassessmentMode
              ? 'Start Skill Reassessment Now'
              : 'Save Details & Start Skill Assessment Test'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
