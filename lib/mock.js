// 下列课程目录仅用于前端演示。资源记录只使用 DSH 提供的字段。
export const courses = [
  { id: 'math', name: '高等数学', college: '数学与计算科学学院', major: '数学与应用数学' },
  { id: 'linear', name: '线性代数', college: '数学与计算科学学院', major: '数学与应用数学' },
  { id: 'ds', name: '数据结构', college: '计算机科学与工程学院', major: '计算机科学与技术' },
  { id: 'os', name: '操作系统', college: '计算机科学与工程学院', major: '软件工程' },
  { id: 'english', name: '大学英语', college: '外国语学院', major: '英语' },
];

export const types = ['复习资料', '课程笔记', '练习题', '课件', '其他'];
export const semesters = ['上学期', '下学期'];

export const initialResources = [
  { id: 'math-review', title: '高等数学期末复习提纲', course_id: 'math', year: 2025, semester: '上学期', type: '复习资料', teacher: '', file_url: '/高等数学期末复习提纲.txt', uploader: '匿名', downloads: 42, status: 'approved' },
  { id: 'ds-notes', title: '数据结构课程笔记', course_id: 'ds', year: 2025, semester: '下学期', type: '课程笔记', teacher: '', file_url: '/数据结构课程笔记.txt', uploader: '匿名', downloads: 28, status: 'approved' },
  { id: 'english-practice', title: '大学英语阅读练习', course_id: 'english', year: 2024, semester: '上学期', type: '练习题', teacher: '', file_url: '/大学英语阅读练习.txt', uploader: '匿名', downloads: 16, status: 'approved' },
  { id: 'linear-review', title: '线性代数复习提纲', course_id: 'linear', year: 2024, semester: '下学期', type: '复习资料', teacher: '', file_url: '/线性代数复习提纲.txt', uploader: '匿名', downloads: 8, status: 'pending' },
];

export const courseName = (id) => courses.find((course) => course.id === id)?.name ?? '未知课程';
