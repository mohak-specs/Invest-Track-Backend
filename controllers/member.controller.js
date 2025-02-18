const AppError = require("../middleware/AppError");
const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const { Firm } = require("../models/firm.model");
const File = require("../models/file.model");
const {
  BrokerMember,
  InvestorMember,
  Member,
} = require("../models/member.model");
const Interaction = require("../models/interaction.model");
const Coverage = require("../models/coverage.model");

// @desc    Get all members
// @route   GET /api/members
// @access  Private
module.exports.getAllMembers = asyncHandler(async (req, res, next) => {
  try {
    const { memberType, perPage, page } = req.query;
    let query;
    switch (memberType) {
      case "broker":
        query = BrokerMember.find()
          .sort({ createdAt: -1 })
          .populate("firm")
          .lean();
        break;
      case "investor":
        query = InvestorMember.find()
          .sort({ createdAt: -1 })
          .populate("firm")
          .lean();
        break;
      default:
        throw new AppError("Invalid member type", 400);
    }
    if (page && perPage) {
      const currentPage = parseInt(page);
      const pageSize = parseInt(perPage);
      const skip = (currentPage - 1) * pageSize;
      query = query.skip(skip).limit(pageSize);
    }
    const members = await query.exec();
    const totalCount = await Member.countDocuments({ memberType });
    return res.status(200).json({
      success: true,
      data: members,
      totalCount,
    });
  } catch (err) {
    next(err);
  }
});

// @desc    Create a new member
// @route   POST /api/members
// @access  Private
module.exports.createMember = asyncHandler(async (req, res, next) => {
  try {
    const { firmId } = req.query;
    if (!firmId) {
      throw new AppError("Please provide a firmId", 400);
    }
    const firm = await Firm.findById(firmId);
    if (!firm) {
      throw new AppError("Firm not found", 404);
    }
    const { type, ...rest } = req.body;
    let member;
    switch (type) {
      case "broker":
        member = new BrokerMember({
          firm: firm._id,
          ...rest,
        });
        break;
      case "investor":
        member = new InvestorMember({
          firm: firm._id,
          ...rest,
        });
        break;
      default:
        throw new AppError("Invalid member type", 400);
    }
    member.firmHistory.push({
      firm: firm._id,
    });
    const file = req.uploadedFile;
    if (file) {
      file.firmId = firm._id;
      file.member = member._id;
      member.businessCard = file._id;
    }
    await member.save();
    await Firm.findByIdAndUpdate(member.firm, {
      $addToSet: {
        members: member._id,
      },
    });
    await file?.save();
    return res.status(201).json({
      success: true,
      data: member,
      message: `Member with name ${member.name} created successfully for ${firm.name}`,
    });
  } catch (err) {
    next(err);
  }
});

// @desc    Get members by firm
// @route   GET /api/members/firm/:firmId
// @access  Private
module.exports.getMembersByFirm = asyncHandler(async (req, res, next) => {
  try {
    const firm = await Firm.findById(req.params.firmId);
    if (!firm) {
      throw new AppError("Firm not found", 404);
    }
    const members = await Member.find({ firm: firm._id });
    return res.status(200).json({
      success: true,
      data: members,
    });
  } catch (err) {
    next(err);
  }
});

// @desc    Get a single member
// @route   GET /api/members/:id
// @access  Private
module.exports.getMember = asyncHandler(async (req, res, next) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      throw new AppError("Member not found", 404);
    }
    return res.status(200).json({
      success: true,
      data: member,
    });
  } catch (err) {
    next(err);
  }
});

// @desc    Update a member
// @route   PUT /api/members/:id
// @access  Private
module.exports.updateMember = asyncHandler(async (req, res, next) => {
  const { memberType, ...rest } = req.body;
  const MemberModel = memberType === "broker" ? BrokerMember : InvestorMember;

  try {
    // Find the member by ID and update it
    let member = await MemberModel.findById(req.params.id);
    // If member not found, throw error
    if (!member) {
      throw new AppError("Member not found", 404);
    }
    // Check if there's an uploaded file
    if (req.uploadedFile) {
      // Update the file details
      const uploadedFile = req.uploadedFile;
      uploadedFile.firmId = member.firm;
      uploadedFile.member = member._id;
      rest.businessCard = uploadedFile._id;

      // If there's an existing businessCard, delete it
      if (member.businessCard) {
        await File.findByIdAndDelete(member.businessCard);
      }
      await uploadedFile.save();
    }
    // Update the member with the new data
    member.set(rest);
    await member.save();
    return res.status(200).json({
      success: true,
      data: member,
      message: `Member with name ${member.name} updated successfully`,
    });
  } catch (err) {
    next(err);
  }
});

// @desc    Delete a member
// @route   DELETE /api/members/:id
// @access  Private
module.exports.deleteMember = asyncHandler(async (req, res, next) => {
  try {
    const member = await Member.findByIdAndDelete(req.params.id);
    if (!member) {
      throw new AppError("Member not found", 404);
    }
    await Firm.findByIdAndUpdate(member.firm, {
      $pull: {
        members: member._id,
      },
    });
    await Interaction.deleteMany({ member: member._id });
    await File.findByIdAndDelete(member.businessCard);
    return res.status(200).json({
      success: true,
      message: `Member with name ${member.name} deleted successfully`,
    });
  } catch (err) {
    next(err);
  }
});

// @desc    Move a member to another firm
// @route   PUT /api/members/:id/move
// @access  Private
module.exports.moveMember = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { targetFirmId, targetMemberType, ...rest } = req.body;
    const targetFirm = await Firm.findById(targetFirmId);
    if (!targetFirm) {
      throw new AppError("Target firm not found", 404);
    }
    const member = await Member.findById(id);
    if (!member) {
      throw new AppError("Member not found", 404);
    }
    if (member.firm.toString() === targetFirmId) {
      throw new AppError("Member already in target firm", 400);
    }
    const targetMemberModel =
      targetMemberType === "BrokerMember" ? BrokerMember : InvestorMember;
    const updatedMember = new targetMemberModel({
      ...member.toObject(),
      _id: new mongoose.Types.ObjectId(),
      firm: targetFirmId,
      memberType: targetMemberType,
    });
    updatedMember.firmHistory.push({
      firm: targetFirmId,
    });
    updatedMember.set(rest);
    await updatedMember.save();
    await Member.findByIdAndDelete(id);
    await Interaction.updateMany(
      { member: member._id },
      { member: updatedMember._id }
    );
    await File.findByIdAndUpdate(member.businessCard, {
      member: updatedMember._id,
    });
    // remove member from old firm
    await Firm.findByIdAndUpdate(member.firm, {
      $pull: {
        members: member._id,
      },
    });
    // add member to new firm
    await Firm.findByIdAndUpdate(targetFirmId, {
      $addToSet: {
        members: updatedMember._id,
      },
    });
    return res.status(200).json({
      success: true,
      data: updatedMember,
      message: `Member with name ${member.name} moved successfully to ${targetFirm.name}`,
    });
  } catch (err) {
    next(err);
  }
});
